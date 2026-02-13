import Anthropic from "@anthropic-ai/sdk";
import type { AgentJobPayload } from "@assembly-lime/shared";
import type { AgentEventEmitter } from "./event-emitter";
import { logger } from "../lib/logger";
import { getCurrentBranch, applyFileChanges, commitAndPush, getDiffUnified } from "../git/git-operations";
import { extractFileChanges } from "../git/change-extractor";
import { readGitToken, createPullRequest, buildPRTitle, buildPRBody } from "../git/pr-creator";

const anthropic = new Anthropic();

const WORKSPACE_SYSTEM_PROMPT = `You are an AI coding agent operating inside a git workspace. You have direct access to the repository files.

When you need to create, modify, or delete files, output them using this XML format:

<file path="relative/path/to/file.ts" action="create">
file content here
</file>

<file path="relative/path/to/file.ts" action="modify">
full file content with modifications
</file>

<file path="relative/path/to/delete.ts" action="delete"></file>

Rules:
- Always provide the FULL file content for create/modify actions (not diffs or patches)
- Use relative paths from the repository root
- You may output multiple <file> blocks in a single response
- Explain your changes before outputting the file blocks
`;

export async function runWorkspaceAgent(
  payload: AgentJobPayload,
  emitter: AgentEventEmitter
): Promise<void> {
  const log = logger.child({ runId: payload.runId });
  const workDir = process.env.WORKSPACE_DIR!;
  const repo = payload.repo!;

  await emitter.emitStatus("running");
  log.info({ workDir, owner: repo.owner, name: repo.name }, "workspace agent started");

  try {
    // 1. Verify workspace branch
    const branch = await getCurrentBranch(workDir);
    const expectedPrefix = `al/${payload.mode}/`;
    if (!branch.startsWith(expectedPrefix)) {
      log.warn({ branch, expectedPrefix }, "workspace branch does not match expected pattern");
    }
    await emitter.emitLog(`workspace branch: ${branch}`);

    // 2. Call Claude with workspace-aware system prompt
    const systemPrompt = [WORKSPACE_SYSTEM_PROMPT, payload.resolvedPrompt].join("\n\n");

    const contentParts: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

    if (payload.images && payload.images.length > 0) {
      for (const img of payload.images) {
        if (img.presignedUrl) {
          const response = await fetch(img.presignedUrl);
          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString("base64");
          const mediaType = img.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
          contentParts.push({
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          });
        }
      }
    }

    contentParts.push({ type: "text", text: payload.inputPrompt });

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 16384,
      system: systemPrompt,
      messages: [{ role: "user", content: contentParts }],
    });

    // 3. Stream response and emit message events
    let fullResponse = "";
    let lastEmitted = 0;
    const CHUNK_SIZE = 200;

    stream.on("text", async (text) => {
      fullResponse += text;
      if (fullResponse.length - lastEmitted >= CHUNK_SIZE) {
        const chunk = fullResponse.slice(lastEmitted);
        lastEmitted = fullResponse.length;
        await emitter.emitMessage("assistant", chunk);
      }
    });

    const finalMessage = await stream.finalMessage();

    // Emit remaining text
    if (fullResponse.length > lastEmitted) {
      await emitter.emitMessage("assistant", fullResponse.slice(lastEmitted));
    }

    // Emit usage
    const usage = finalMessage.usage;
    await emitter.emitLog(`tokens: input=${usage.input_tokens} output=${usage.output_tokens}`);

    // 4. Extract file changes
    const changes = extractFileChanges(fullResponse);
    if (changes.length === 0) {
      await emitter.emitLog("no file changes detected in agent response");
      await emitter.emitStatus("completed", "Agent completed without file changes");
      return;
    }

    await emitter.emitLog(`extracted ${changes.length} file change(s)`);

    // 5. Apply changes to workspace
    applyFileChanges(workDir, changes);
    await emitter.emitLog("file changes applied to workspace");

    // 6. Get unified diff and emit
    const baseBranch = repo.ref ?? repo.defaultBranch;
    const diff = await getDiffUnified(workDir, `origin/${baseBranch}`);
    if (diff) {
      await emitter.emitDiff(diff, `${changes.length} file(s) changed`);
    }

    // 7. Commit and push
    const commitMsg = `[AL/${payload.mode}] ${payload.inputPrompt.slice(0, 72)}`;
    try {
      const { commitSha, diffStats } = await commitAndPush(workDir, branch, commitMsg);
      await emitter.emitLog(`committed and pushed: ${commitSha}`);

      // 8. Create PR (fork-aware: if IS_FORK is set, use forkOwner for head prefix)
      try {
        const token = readGitToken();
        const isFork = process.env.IS_FORK === "true";
        const forkOwner = process.env.FORK_OWNER;

        const prResult = await createPullRequest(token, {
          owner: repo.owner,
          repo: repo.name,
          head: branch,
          base: baseBranch,
          title: buildPRTitle(payload.mode, payload.inputPrompt),
          body: buildPRBody({
            mode: payload.mode,
            runId: payload.runId,
            prompt: payload.inputPrompt,
            diffStats,
          }),
          draft: payload.mode === "plan",
          forkOwner: isFork && forkOwner ? forkOwner : undefined,
        });

        await emitter.emitArtifact("Pull Request", prResult.url);
        await emitter.emitLog(`PR #${prResult.number} created: ${prResult.url}`);
      } catch (prErr) {
        // PR failure is non-fatal — code is already pushed
        const msg = prErr instanceof Error ? prErr.message : String(prErr);
        log.warn({ err: prErr }, "PR creation failed (code is pushed)");
        await emitter.emitLog(`PR creation failed (code is pushed): ${msg}`);
      }

      await emitter.emitStatus("completed", "Agent run completed successfully");
    } catch (pushErr) {
      const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
      await emitter.emitError(`push failed: ${msg}`);
      await emitter.emitStatus("failed", msg);
    }

    log.info({ usage }, "workspace agent completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    await emitter.emitError(message, stack);
    await emitter.emitStatus("failed", message);
    log.error({ err }, "workspace agent failed");
  }
}
