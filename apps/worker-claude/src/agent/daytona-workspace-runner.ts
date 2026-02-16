import Anthropic from "@anthropic-ai/sdk";
import type { AgentJobPayload } from "@assembly-lime/shared";
import { DaytonaWorkspace, extractFileChanges } from "@assembly-lime/shared";
import type { AgentEventEmitter } from "./event-emitter";
import { createPullRequest, buildPRTitle, buildPRBody } from "../git/pr-creator";
import { logger } from "../lib/logger";

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

export async function runDaytonaWorkspaceAgent(
  payload: AgentJobPayload,
  emitter: AgentEventEmitter,
  workspace: DaytonaWorkspace,
): Promise<void> {
  const log = logger.child({ runId: payload.runId });
  const repo = payload.repo!;

  await emitter.emitStatus("running");
  log.info({ owner: repo.owner, name: repo.name }, "daytona workspace agent started");

  try {
    // 1. Verify workspace branch
    const branch = await workspace.getCurrentBranch();
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

    // 5. Apply changes via Daytona SDK
    for (const change of changes) {
      if (change.action === "delete") {
        await workspace.deleteFile(change.path);
        log.info({ path: change.path }, "file deleted");
      } else {
        await workspace.writeFile(change.path, change.content ?? "");
        log.info({ path: change.path, action: change.action }, "file written");
      }
    }
    await emitter.emitLog("file changes applied to workspace");

    // 6. Get unified diff and emit
    const baseBranch = repo.ref ?? repo.defaultBranch;
    const diff = await workspace.getDiffUnified(`origin/${baseBranch}`);
    if (diff) {
      await emitter.emitDiff(diff, `${changes.length} file(s) changed`);
    }

    // 7. Commit and push
    const commitMsg = `[AL/${payload.mode}] ${payload.inputPrompt.slice(0, 72)}`;
    try {
      await workspace.stageAll();

      const commitSha = await workspace.commit(
        commitMsg,
        "Assembly Lime",
        "agent@assemblylime.dev",
      );
      await workspace.push();
      await emitter.emitLog(`committed and pushed: ${commitSha}`);

      const diffStats = await workspace.getDiffStats(`${branch}~1`);

      // 8. Create PR using authToken from payload
      try {
        const token = repo.authToken;
        if (!token) throw new Error("No auth token available for PR creation");

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
        });

        await emitter.emitArtifact("Pull Request", prResult.url);
        await emitter.emitLog(`PR #${prResult.number} created: ${prResult.url}`);
      } catch (prErr) {
        const msg = prErr instanceof Error ? prErr.message : String(prErr);
        log.warn({ err: prErr }, "PR creation failed (code is pushed)");
        await emitter.emitLog(`PR creation failed (code is pushed): ${msg}`);
      }

      // 9. Start dev server + preview
      try {
        await startDevServerAndPreview(workspace, payload, emitter, branch);
      } catch (e) {
        log.warn({ err: (e as Error)?.message }, "dev server preview failed");
      }

      await emitter.emitStatus("completed", "Agent run completed successfully");
    } catch (pushErr) {
      const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
      await emitter.emitError(`push failed: ${msg}`);
      await emitter.emitStatus("failed", msg);
    }

    log.info({ usage }, "daytona workspace agent completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    await emitter.emitError(message, stack);
    await emitter.emitStatus("failed", message);
    log.error({ err }, "daytona workspace agent failed");
  }
}

/**
 * Start dev server via DaytonaWorkspace.startDevServer() (which reads .env
 * files for PORT override), emit preview URL, and register sandbox with API.
 */
async function startDevServerAndPreview(
  workspace: DaytonaWorkspace,
  payload: AgentJobPayload,
  emitter: AgentEventEmitter,
  branch: string,
): Promise<void> {
  const log = logger.child({ runId: payload.runId });

  const sessionId = `run-${payload.runId}`;
  const result = await workspace.startDevServer(sessionId);
  log.info(
    { port: result.port, portSource: result.portSource, startCommand: result.startCommand },
    "dev server starting in background session",
  );

  if (result.previewUrl) {
    await emitter.emit({ type: "preview", previewUrl: result.previewUrl, branch, status: "active" });
    log.info({ previewUrl: result.previewUrl }, "preview link emitted");

    // Register with API
    try {
      const apiBase = (process.env.API_BASE_URL || "http://localhost:3434").replace(/\/$/, "");
      const internalKey = process.env.INTERNAL_AGENT_API_KEY;
      if (internalKey && payload.repo) {
        const body = {
          tenantId: payload.tenantId,
          repositoryId: payload.repo.repositoryId,
          branch,
          sandboxId: workspace.sandbox.id,
          previewUrl: result.previewUrl,
          status: "running",
          ports: [{ containerPort: result.port, source: result.portSource, provider: "daytona" }],
        };
        await fetch(`${apiBase}/sandboxes/register-internal`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-key": internalKey,
          },
          body: JSON.stringify(body),
        });
        log.info({ sandboxId: workspace.sandbox.id }, "sandbox registered with API");
      }
    } catch (e) {
      log.warn({ err: (e as Error)?.message }, "failed to register sandbox in API");
    }
  }
}
