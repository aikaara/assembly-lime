import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@assembly-lime/pi-agent";
import type { AgentEventEmitter } from "../agent/emitter.js";

const Parameters = Type.Object({
  ticketId: Type.String({ description: "The ticket ID to update (from create_tasks output)" }),
  status: Type.Union(
    [Type.Literal("in_progress"), Type.Literal("completed")],
    { description: "New status for the task" },
  ),
});

export function createUpdateTaskStatusTool(
  emitter: AgentEventEmitter,
): AgentTool<typeof Parameters> {
  return {
    name: "update_task_status",
    label: "Update Task Status",
    description:
      "Update the status of a previously created task. Use this to track progress: " +
      "mark tasks as 'in_progress' when you start working on them and 'completed' when done.",
    parameters: Parameters,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      const tasks = emitter.getTaskList();
      const task = tasks.find((t) => t.ticketId === params.ticketId);

      if (!task) {
        return {
          content: [
            {
              type: "text",
              text: `Task with ticketId "${params.ticketId}" not found. Available ticket IDs: ${tasks.map((t) => t.ticketId).join(", ") || "(none)"}`,
            },
          ],
          details: {},
          isError: true,
        };
      }

      await emitter.updateTaskStatus(params.ticketId, params.status);

      return {
        content: [
          {
            type: "text",
            text: `Task #${params.ticketId} ("${task.title}") updated to ${params.status}.`,
          },
        ],
        details: {},
      };
    },
  };
}
