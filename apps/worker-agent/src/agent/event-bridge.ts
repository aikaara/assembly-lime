import type { AgentEvent as PiAgentEvent } from "@assembly-lime/pi-agent";
import type { AgentEventEmitter } from "./emitter";
import type { Logger } from "pino";

/**
 * Bridge pi-agent events to assemblyLime agent events (HTTP POST to API).
 *
 * Text deltas are batched with a 200ms flush timer to avoid flooding
 * the API with per-token HTTP POSTs.
 *
 * Enhanced for:
 * - Edit tool diff emission
 * - Subagent progress streaming
 * - Bash output streaming
 */
export function bridgeEvents(
  emitter: AgentEventEmitter,
  log: Logger,
): (event: PiAgentEvent) => void {
  let textBuffer = "";
  let thinkingBuffer = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const FLUSH_INTERVAL = 200;

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, FLUSH_INTERVAL);
  }

  function flush() {
    if (textBuffer) {
      emitter.emitMessage("assistant", textBuffer).catch(() => {});
      textBuffer = "";
    }
    if (thinkingBuffer) {
      emitter.emitLog(`thinking: ${thinkingBuffer}`).catch(() => {});
      thinkingBuffer = "";
    }
  }

  return (event: PiAgentEvent) => {
    switch (event.type) {
      case "agent_start":
        emitter.emitStatus("running").catch(() => {});
        break;

      case "message_update": {
        const ame = event.assistantMessageEvent;
        if (ame.type === "text_delta") {
          textBuffer += ame.delta;
          scheduleFlush();
        } else if (ame.type === "thinking_delta") {
          thinkingBuffer += ame.delta;
          scheduleFlush();
        }
        break;
      }

      case "tool_execution_start":
        flush();
        emitter.emitLog(`tool: ${event.toolName}`).catch(() => {});
        break;

      case "tool_execution_update": {
        // Stream bash output and subagent progress as log events
        const partial = event.partialResult;
        if (event.toolName === "bash" && partial?.content?.[0]?.type === "text") {
          const text = partial.content[0].text;
          if (text) {
            // Only emit meaningful updates (not empty)
            const lastLine = text.split("\n").filter((l: string) => l.trim()).pop();
            if (lastLine) {
              emitter.emitLog(`bash: ${lastLine.slice(0, 200)}`).catch(() => {});
            }
          }
        } else if (event.toolName === "subagent" && partial?.content?.[0]?.type === "text") {
          emitter.emitLog(partial.content[0].text.slice(0, 200)).catch(() => {});
        }
        break;
      }

      case "tool_execution_end": {
        if (event.isError) {
          const errText =
            event.result?.content?.[0]?.type === "text"
              ? event.result.content[0].text
              : "unknown error";
          emitter.emitLog(`tool error (${event.toolName}): ${errText}`).catch(() => {});
        } else if (event.toolName === "edit") {
          // Emit diff from edit tool result details
          const diff = event.result?.details?.diff;
          if (diff) {
            emitter.emitDiff(diff, `Edit: ${event.args?.path ?? "unknown file"}`).catch(() => {});
          }
        } else if (event.toolName === "git_diff") {
          const diffText =
            event.result?.content?.[0]?.type === "text"
              ? event.result.content[0].text
              : "";
          if (diffText && diffText !== "(no changes)") {
            emitter.emitDiff(diffText).catch(() => {});
          }
        }
        break;
      }

      case "agent_end": {
        flush();
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }

        const msgs = event.messages;
        const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant") as any;
        if (lastAssistant?.usage) {
          const u = lastAssistant.usage;
          emitter
            .emitLog(
              `tokens: input=${u.input} output=${u.output} cost=$${u.cost?.total?.toFixed(4) ?? "?"}`,
            )
            .catch(() => {});
        }

        const hasError = lastAssistant?.stopReason === "error" || lastAssistant?.errorMessage;
        if (hasError) {
          const errMsg = lastAssistant.errorMessage ?? "Agent run failed";
          emitter.emitError(errMsg).catch(() => {});
          emitter.emitStatus("failed", errMsg).catch(() => {});
          log.error({ error: errMsg }, "agent run failed");
        } else {
          emitter.emitStatus("completed", "Agent run completed").catch(() => {});
        }
        break;
      }

      case "turn_start":
      case "turn_end":
      case "message_start":
      case "message_end":
        break;
    }
  };
}
