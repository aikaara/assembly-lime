import { useMemo } from "react";
import type { AgentEvent } from "../types";

export type EventGroupKind =
  | "initial_prompt"
  | "user_message"
  | "assistant_message"
  | "tool_messages"
  | "log_group"
  | "status"
  | "diff"
  | "error"
  | "tasks"
  | "sandbox"
  | "preview"
  | "artifact";

export type EventGroup = {
  kind: EventGroupKind;
  events: AgentEvent[];
};

export function useEventGroups(
  events: AgentEvent[],
  inputPrompt?: string | null,
): EventGroup[] {
  return useMemo(() => {
    const groups: EventGroup[] = [];

    // Prepend the initial prompt as first chat bubble
    if (inputPrompt) {
      groups.push({
        kind: "initial_prompt",
        events: [{ type: "user_message", text: inputPrompt }],
      });
    }

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      switch (event.type) {
        case "user_message": {
          groups.push({ kind: "user_message", events: [event] });
          break;
        }

        case "message": {
          if (event.role === "assistant") {
            // Merge consecutive assistant messages
            const last = groups[groups.length - 1];
            if (last && last.kind === "assistant_message") {
              last.events.push(event);
            } else {
              groups.push({ kind: "assistant_message", events: [event] });
            }
          } else if (event.role === "tool") {
            // Merge consecutive tool messages
            const last = groups[groups.length - 1];
            if (last && last.kind === "tool_messages") {
              last.events.push(event);
            } else {
              groups.push({ kind: "tool_messages", events: [event] });
            }
          } else {
            // system messages → treat as log
            const last = groups[groups.length - 1];
            if (last && last.kind === "log_group") {
              last.events.push(event);
            } else {
              groups.push({ kind: "log_group", events: [event] });
            }
          }
          break;
        }

        case "log": {
          const last = groups[groups.length - 1];
          if (last && last.kind === "log_group") {
            last.events.push(event);
          } else {
            groups.push({ kind: "log_group", events: [event] });
          }
          break;
        }

        case "status": {
          groups.push({ kind: "status", events: [event] });
          break;
        }

        case "diff": {
          groups.push({ kind: "diff", events: [event] });
          break;
        }

        case "error": {
          groups.push({ kind: "error", events: [event] });
          break;
        }

        case "tasks": {
          groups.push({ kind: "tasks", events: [event] });
          break;
        }

        case "sandbox": {
          groups.push({ kind: "sandbox", events: [event] });
          break;
        }

        case "preview": {
          groups.push({ kind: "preview", events: [event] });
          break;
        }

        case "artifact": {
          groups.push({ kind: "artifact", events: [event] });
          break;
        }
      }
    }

    return groups;
  }, [events, inputPrompt]);
}
