import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage, SDKResultSuccess, SDKResultError } from "@anthropic-ai/claude-agent-sdk";
import type { AgentJobPayload } from "@assembly-lime/shared";
import { DaytonaWorkspace } from "@assembly-lime/shared";
import type { AgentEventEmitter } from "./event-emitter";
import { createPullRequest, buildPRTitle, buildPRBody } from "../git/pr-creator";
import { createDaytonaMcpServer } from "./daytona-mcp";
import { logger } from "../lib/logger";

const DAYTONA_SYSTEM_PROMPT = `You are an AI coding agent operating in a remote Daytona workspace.

Use the daytona_* MCP tools to interact with files and run commands:
- daytona_read_file: Read a file by relative path
- daytona_write_file: Write/create a file by relative path
- daytona_delete_file: Delete a file
- daytona_exec: Run a shell command in the workspace
- daytona_list_files: List files in a directory

Rules:
- Always use relative paths from the repository root
- Use daytona_exec for running tests, installing deps, etc.
- Explain your changes before making them
`;

export async function runDaytonaWorkspaceAgent(
  payload: AgentJobPayload,
  emitter: AgentEventEmitter,
  workspace: DaytonaWorkspace,
): Promise<void> {
  const log = logger.child({ runId: payload.runId });
  const repo = payload.repo!;

  await emitter.emitStatus("running");
  log.info({ owner: repo.owner, name: repo.name }, "daytona workspace agent started (Agent SDK)");

  try {
    // 1. Verify workspace branch
    const branch = await workspace.getCurrentBranch();
    await emitter.emitLog(`workspace branch: ${branch}`);

    // 2. Build system prompt
    const systemPrompt = [DAYTONA_SYSTEM_PROMPT, payload.resolvedPrompt].join(
      "\n\n"
    );

    // 3. Create in-process MCP server for Daytona file/process operations
    const daytonaMcp = createDaytonaMcpServer(workspace);

    // SDK MCP servers require async generator prompt input
    async function* promptGenerator(): AsyncGenerator<SDKUserMessage> {
      yield {
        type: "user",
        message: {
          role: "user",
          content: payload.inputPrompt,
        },
        parent_tool_use_id: null,
        session_id: "",
      };
    }

    // 4. Run Agent SDK with Daytona MCP tools (no built-in tools)
    for await (const message of query({
      prompt: promptGenerator(),
      options: {
        systemPrompt,
        allowedTools: [
          "mcp__daytona-workspace__daytona_read_file",
          "mcp__daytona-workspace__daytona_write_file",
          "mcp__daytona-workspace__daytona_delete_file",
          "mcp__daytona-workspace__daytona_exec",
          "mcp__daytona-workspace__daytona_list_files",
        ],
        mcpServers: {
          "daytona-workspace": daytonaMcp,
        },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        model: "sonnet",
        maxTurns: 40,
        env: {
          ...(process.env as Record<string, string>),
        },
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
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

    // 5. Post-agent: get diff, commit, push, create PR
    const baseBranch = repo.ref ?? repo.defaultBranch;
    const diff = await workspace.getDiffUnified(`origin/${baseBranch}`);
    if (diff) {
      await emitter.emitDiff(diff);
    }

    const commitMsg = `[AL/${payload.mode}] ${payload.inputPrompt.slice(0, 72)}`;
    await workspace.stageAll();
    const commitSha = await workspace.commit(
      commitMsg,
      "Assembly Lime",
      "agent@assemblylime.dev"
    );
    await workspace.push();
    await emitter.emitLog(`committed and pushed: ${commitSha}`);

    const diffStats = await workspace.getDiffStats(`${branch}~1`);

    // 6. Create PR
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

    // 7. Start dev server + preview
    try {
      await startDevServerAndPreview(workspace, payload, emitter, branch);
    } catch (e) {
      log.warn({ err: (e as Error)?.message }, "dev server preview failed");
    }

    await emitter.emitStatus("completed", "Agent run completed successfully");
    log.info("daytona workspace agent completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    await emitter.emitError(message, stack);
    await emitter.emitStatus("failed", message);
    log.error({ err }, "daytona workspace agent failed");
  }
}

/**
 * Start dev server via DaytonaWorkspace.startDevServer() and emit preview URL.
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
