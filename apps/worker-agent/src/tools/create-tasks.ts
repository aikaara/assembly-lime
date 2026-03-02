import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@assembly-lime/pi-agent";
import type { AgentEventEmitter } from "../agent/emitter.js";

const CodeContextItem = Type.Object({
  repo: Type.String({ description: "Repository full name (e.g. 'owner/repo')" }),
  filePath: Type.String({ description: "File path within the repository" }),
  symbolName: Type.Optional(Type.String({ description: "Function/class/type name if applicable" })),
  startLine: Type.Number({ description: "Start line number" }),
  endLine: Type.Number({ description: "End line number" }),
  reason: Type.String({ description: "Why this code is relevant to the task" }),
});

const TaskItem = Type.Object({
  title: Type.String({ description: "Task title — imperative, specific (e.g. 'Add validation to signup form')" }),
  description: Type.Optional(
    Type.String({ description: "Detailed description of what needs to be done, including acceptance criteria" })
  ),
  codeContext: Type.Optional(
    Type.Array(CodeContextItem, {
      description: "Code references from semantic search results that are relevant to this task",
    })
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
      // Enrich task descriptions with code context references
      const enrichedTasks = params.tasks.map((task) => {
        let description = task.description ?? "";
        if (task.codeContext && task.codeContext.length > 0) {
          description += "\n\n### Code References\n";
          for (const ctx of task.codeContext) {
            const symbol = ctx.symbolName ? ` (${ctx.symbolName})` : "";
            description += `- **${ctx.repo}** — \`${ctx.filePath}:${ctx.startLine}-${ctx.endLine}\`${symbol}: ${ctx.reason}\n`;
          }
        }
        return { title: task.title, description: description || undefined };
      });

      const created = await emitter.emitTasks(enrichedTasks);

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
