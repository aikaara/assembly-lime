import type { AgentEvent as PiAgentEvent } from "@assembly-lime/pi-agent";
import type { AgentEventEmitter } from "./emitter";
import type { Logger } from "pino";

export interface BridgeEventsOpts {
  onMaxTurns?: () => void;
  maxTurns?: number;
  suppressTerminalStatus?: boolean;
}

export interface EventBridge {
  handler: (event: PiAgentEvent) => void;
  getTurnNumber: () => number;
}

/**
 * Bridge pi-agent events to assemblyLime agent events (HTTP POST to API).
 *
 * Text is accumulated per turn and emitted as ONE complete message on turn_end.
 * Tool diffs and bash output are emitted as they happen.
 */
export function bridgeEvents(
  emitter: AgentEventEmitter,
  log: Logger,
  opts?: BridgeEventsOpts,
): EventBridge {
  let turnTextBuffer = "";
  let turnThinkingBuffer = "";

  let turnNumber = 0;
  let turnStartTime = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const maxTurns = opts?.maxTurns ?? 50;

  const handler = (event: PiAgentEvent) => {
    switch (event.type) {
      case "agent_start":
        emitter.emitStatus("running").catch(() => {});
        heartbeatTimer = setInterval(() => {
          emitter.emitLog(`heartbeat: alive, turn ${turnNumber}`).catch(() => {});
        }, 30_000);
        break;

      case "message_update": {
        const ame = event.assistantMessageEvent;
        if (ame.type === "text_delta") {
          turnTextBuffer += ame.delta;
        } else if (ame.type === "thinking_delta") {
          turnThinkingBuffer += ame.delta;
        }
        break;
      }

      case "tool_execution_start":
        emitter.emitLog(`tool: ${event.toolName}`).catch(() => {});
        break;

      case "tool_execution_update": {
        const partial = event.partialResult;
        if (event.toolName === "bash" && partial?.content?.[0]?.type === "text") {
          const text = partial.content[0].text;
          if (text) {
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

      case "turn_start":
        turnNumber++;
        turnStartTime = Date.now();
        turnTextBuffer = "";
        turnThinkingBuffer = "";

        if (turnNumber > maxTurns && opts?.onMaxTurns) {
          log.warn({ turnNumber, maxTurns }, "max turns reached, triggering safety callback");
          opts.onMaxTurns();
        }
        break;

      case "turn_end": {
        // Emit complete assistant message for this turn
        if (turnTextBuffer) {
          emitter.emitMessage("assistant", turnTextBuffer).catch(() => {});
        }
        if (turnThinkingBuffer) {
          emitter.emitLog(`thinking: ${turnThinkingBuffer}`).catch(() => {});
        }
        turnTextBuffer = "";
        turnThinkingBuffer = "";

        // Emit LLM call dump
        const msg = event.message as any;
        const durationMs = turnStartTime > 0 ? Date.now() - turnStartTime : undefined;

        if (msg?.role === "assistant") {
          const u = msg.usage;
          log.info(
            { turnNumber, role: msg.role, hasUsage: !!u, model: msg.model, stopReason: msg.stopReason },
            "turn_end: capturing LLM call dump",
          );
          emitter
            .emitLlmCallDump({
              turnNumber,
              model: msg.model ?? "unknown",
              provider: String(msg.provider ?? "unknown"),
              responseJson: msg.content,
              inputTokens: u?.input ?? 0,
              outputTokens: u?.output ?? 0,
              cacheReadTokens: u?.cacheRead ?? 0,
              cacheWriteTokens: u?.cacheWrite ?? 0,
              totalTokens: u?.totalTokens ?? 0,
              costCents: (u?.cost?.total ?? 0) * 100,
              stopReason: msg.stopReason,
              durationMs,
            })
            .catch((err) => log.warn({ err }, "failed to emit LLM call dump"));
        } else {
          log.warn(
            { turnNumber, role: msg?.role, type: typeof msg },
            "turn_end: message is not an assistant message, skipping LLM dump",
          );
        }
        break;
      }

      case "agent_end": {
        // Clear heartbeat
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }

        // Emit any remaining buffered text
        if (turnTextBuffer) {
          emitter.emitMessage("assistant", turnTextBuffer).catch(() => {});
          turnTextBuffer = "";
        }
        if (turnThinkingBuffer) {
          emitter.emitLog(`thinking: ${turnThinkingBuffer}`).catch(() => {});
          turnThinkingBuffer = "";
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
        if (!opts?.suppressTerminalStatus) {
          if (hasError) {
            const errMsg = lastAssistant.errorMessage ?? "Agent run failed";
            emitter.emitError(errMsg).catch(() => {});
            emitter.emitStatus("failed", errMsg).catch(() => {});
            log.error({ error: errMsg }, "agent run failed");
          } else {
            emitter.emitStatus("completed", "Agent run completed").catch(() => {});
          }
        } else if (hasError) {
          const errMsg = lastAssistant.errorMessage ?? "Agent run failed";
          emitter.emitError(errMsg).catch(() => {});
          log.error({ error: errMsg }, "agent run failed (terminal status suppressed)");
        }
        break;
      }

      case "message_start":
      case "message_end":
        break;
    }
  };

  return {
    handler,
    getTurnNumber: () => turnNumber,
  };
}
