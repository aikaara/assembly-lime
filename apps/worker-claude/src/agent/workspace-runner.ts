import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultSuccess, SDKResultError } from "@anthropic-ai/claude-agent-sdk";
import type { AgentJobPayload } from "@assembly-lime/shared";
import type { AgentEventEmitter } from "./event-emitter";
import { logger } from "../lib/logger";
import {
  getCurrentBranch,
  commitAndPush,
  getDiffUnified,
} from "../git/git-operations";
import {
  readGitToken,
  createPullRequest,
  buildPRTitle,
  buildPRBody,
} from "../git/pr-creator";

export async function runWorkspaceAgent(
  payload: AgentJobPayload,
  emitter: AgentEventEmitter
): Promise<void> {
  const log = logger.child({ runId: payload.runId });
  const workDir = process.env.WORKSPACE_DIR!;
  const repo = payload.repo!;

  await emitter.emitStatus("running");
  log.info(
    { workDir, owner: repo.owner, name: repo.name },
    "workspace agent started (Agent SDK)"
  );

  try {
    // 1. Verify workspace branch
    const branch = await getCurrentBranch(workDir);
    await emitter.emitLog(`workspace branch: ${branch}`);

    // 2. Run Agent SDK — Claude uses built-in tools to read/edit files directly
    for await (const message of query({
      prompt: payload.inputPrompt,
      options: {
        systemPrompt: payload.resolvedPrompt,
        cwd: workDir,
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        model: "sonnet",
        maxTurns: 40,
        executable: "bun",
        env: {
          CLAUDE_CODE_USE_BEDROCK: "1",
          ...(process.env as Record<string, string>),
        },
      },
    })) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if ("text" in block && block.text) {
            await emitter.emitMessage("assistant", block.text);
          } else if ("name" in block) {
            await emitter.emitLog(`tool: ${block.name}`);
          }
        }
      }

      if (message.type === "result") {
        const result = message as SDKResultSuccess | SDKResultError;
        if (result.subtype !== "success") {
          const errorMsg = result.errors.join("; ") || `Agent failed: ${result.subtype}`;
          throw new Error(errorMsg);
        }
        await emitter.emitLog(
          `tokens: input=${result.usage.input_tokens} output=${result.usage.output_tokens} cost=$${result.total_cost_usd.toFixed(4)}`
        );
      }
    }

    // 3. Get unified diff and emit
    const baseBranch = repo.ref ?? repo.defaultBranch;
    const diff = await getDiffUnified(workDir, `origin/${baseBranch}`);
    if (diff) {
      await emitter.emitDiff(diff);
    }

    // 4. Commit and push
    const commitMsg = `[AL/${payload.mode}] ${payload.inputPrompt.slice(0, 72)}`;
    const { commitSha, diffStats } = await commitAndPush(
      workDir,
      branch,
      commitMsg
    );
    await emitter.emitLog(`committed and pushed: ${commitSha}`);

    // 5. Create PR
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
      const msg = prErr instanceof Error ? prErr.message : String(prErr);
      log.warn({ err: prErr }, "PR creation failed (code is pushed)");
      await emitter.emitLog(`PR creation failed (code is pushed): ${msg}`);
    }

    await emitter.emitStatus("completed", "Agent run completed successfully");
    log.info("workspace agent completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    await emitter.emitError(message, stack);
    await emitter.emitStatus("failed", message);
    log.error({ err }, "workspace agent failed");
  }
}
