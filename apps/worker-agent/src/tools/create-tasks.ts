import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@assembly-lime/pi-agent";
import type { AgentEventEmitter } from "../agent/emitter.js";

const TaskItem = Type.Object({
  title: Type.String({ description: "Task title — imperative, specific (e.g. 'Add validation to signup form')" }),
  description: Type.Optional(
    Type.String({ description: "Detailed description of what needs to be done, including acceptance criteria" })
  ),
});

const Parameters = Type.Object({
  tasks: Type.Array(TaskItem, {
    description: "List of tasks to create as tickets on the project board",
    minItems: 1,
  }),
});

export function createTasksTool(
  emitter: AgentEventEmitter,
): AgentTool<typeof Parameters> {
  return {
    name: "create_tasks",
    label: "Create Tasks",
    description:
      "Create implementation tasks as tickets on the project board. " +
      "Each task becomes a ticket in the Todo column. Use this after analyzing the codebase " +
      "and breaking down the work into concrete, actionable subtasks.",
    parameters: Parameters,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      const created = await emitter.emitTasks(params.tasks);

      const summary = created
        .map((t) => `- Ticket #${t.ticketId}: ${t.title}`)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Created ${created.length} task(s):\n${summary}`,
          },
        ],
        details: {},
      };
    },
  };
}
