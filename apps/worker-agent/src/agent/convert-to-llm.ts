import type { Message } from "@assembly-lime/pi-ai";
import type { AgentMessage } from "@assembly-lime/pi-agent";

/**
 * Keep only LLM-compatible messages (user, assistant, toolResult).
 * Filters out any custom message types that may be in the conversation.
 */
export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter(
    (m): m is Message =>
      m.role === "user" || m.role === "assistant" || m.role === "toolResult",
  );
}
