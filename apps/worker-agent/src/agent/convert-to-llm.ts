import type { Message } from "@assembly-lime/pi-ai";
import type { AgentMessage } from "@assembly-lime/pi-agent";

const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:\n\n<summary>\n`;
const COMPACTION_SUMMARY_SUFFIX = `\n</summary>`;

/**
 * Transform AgentMessages (including custom types) to LLM-compatible Messages.
 * Handles: user, assistant, toolResult passthrough.
 * Custom types: compactionSummary → user message with <summary> tags,
 *               custom → user message with content.
 */
export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages
    .map((m): Message | undefined => {
      switch (m.role) {
        case "user":
        case "assistant":
        case "toolResult":
          return m;

        case "compactionSummary": {
          const msg = m as any;
          return {
            role: "user",
            content: [
              {
                type: "text" as const,
                text: COMPACTION_SUMMARY_PREFIX + msg.summary + COMPACTION_SUMMARY_SUFFIX,
              },
            ],
            timestamp: msg.timestamp,
          };
        }

        case "custom": {
          const msg = m as any;
          const content =
            typeof msg.content === "string"
              ? [{ type: "text" as const, text: msg.content }]
              : msg.content;
          return {
            role: "user",
            content,
            timestamp: msg.timestamp,
          };
        }

        default:
          // Filter out unknown custom message types
          return undefined;
      }
    })
    .filter((m): m is Message => m !== undefined);
}
