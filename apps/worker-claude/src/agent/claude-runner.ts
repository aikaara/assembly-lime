import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultSuccess, SDKResultError } from "@anthropic-ai/claude-agent-sdk";
import type { AgentJobPayload } from "@assembly-lime/shared";
import type { AgentEventEmitter } from "./event-emitter";
import { logger } from "../lib/logger";

export async function runClaudeAgent(
  payload: AgentJobPayload,
  emitter: AgentEventEmitter
): Promise<void> {
  const log = logger.child({ runId: payload.runId });

  await emitter.emitStatus("running");
  log.info("claude agent started (Agent SDK)");

  try {
    // Restrict tools based on agent mode: plan = read-only, others = full
    const allowedTools: string[] =
      payload.mode === "plan"
        ? ["Read", "Glob", "Grep"]
        : ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];

    for await (const message of query({
      prompt: payload.inputPrompt,
      options: {
        systemPrompt: payload.resolvedPrompt,
        allowedTools,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        model: "sonnet",
        maxTurns: 25,
        pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH || "claude",
        env: {
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
        if (result.subtype === "success") {
          await emitter.emitLog(
            `tokens: input=${result.usage.input_tokens} output=${result.usage.output_tokens} cost=$${result.total_cost_usd.toFixed(4)}`
          );
          await emitter.emitStatus(
            "completed",
            result.result || "Agent run completed"
          );
        } else {
          const errorMsg = result.errors.join("; ") || `Agent failed: ${result.subtype}`;
          await emitter.emitError(errorMsg);
          await emitter.emitStatus("failed", errorMsg);
        }
      }
    }

    log.info("claude agent completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    await emitter.emitError(message, stack);
    await emitter.emitStatus("failed", message);
    log.error({ err }, "claude agent failed");
  }
}
