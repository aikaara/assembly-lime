import type { AgentMessage } from "@assembly-lime/pi-agent";
import type { AgentEventEmitter } from "./emitter";

/**
 * Rough token estimate: ~4 chars per token.
 */
function estimateTokens(msg: AgentMessage): number {
  let text = "";
  if ("content" in msg) {
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if ("text" in c && typeof c.text === "string") text += c.text;
        if ("thinking" in c && typeof c.thinking === "string") text += c.thinking;
        if ("arguments" in c) text += JSON.stringify(c.arguments);
      }
    }
  }
  if ("summary" in msg && typeof (msg as any).summary === "string") {
    text += (msg as any).summary;
  }
  return Math.ceil(text.length / 4);
}

function estimateTotalTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}

/**
 * Creates a transformContext function that compacts the conversation
 * when it exceeds 80% of the context window.
 *
 * Strategy: keep the most recent messages that fit in 70% of the window,
 * prepend a compactionSummary message summarizing what was dropped.
 */
export function createTransformContext(
  contextWindow: number,
  emitter?: AgentEventEmitter,
): (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]> {
  const threshold = Math.floor(contextWindow * 0.8);
  const budget = Math.floor(contextWindow * 0.7);

  return async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    const tokensBefore = estimateTotalTokens(messages);
    if (tokensBefore <= threshold) {
      return messages;
    }

    // Keep recent messages within budget
    const kept: AgentMessage[] = [];
    let keptTokens = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = estimateTokens(messages[i]!);
      if (keptTokens + msgTokens > budget) break;
      kept.unshift(messages[i]!);
      keptTokens += msgTokens;
    }

    // If we couldn't fit anything, keep at least the last message
    if (kept.length === 0 && messages.length > 0) {
      kept.push(messages[messages.length - 1]!);
      keptTokens = estimateTokens(kept[0]!);
    }

    const droppedCount = messages.length - kept.length;
    const summary = `[Compacted: dropped ${droppedCount} earlier messages (~${tokensBefore - keptTokens} tokens). Keeping ${kept.length} recent messages.]`;

    const compactionMessage: AgentMessage = {
      role: "compactionSummary",
      summary,
      timestamp: Date.now(),
    } as any;

    const tokensAfter = estimateTotalTokens(kept) + Math.ceil(summary.length / 4);

    if (emitter) {
      emitter
        .emitLog(`compaction: ${tokensBefore} → ${tokensAfter} tokens (dropped ${droppedCount} messages)`)
        .catch(() => {});
    }

    return [compactionMessage, ...kept];
  };
}
