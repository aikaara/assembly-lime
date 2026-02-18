import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@assembly-lime/pi-agent";
import { resolve, relative } from "node:path";
import { readFile } from "node:fs/promises";

const Parameters = Type.Object({
  path: Type.String({ description: "Relative or absolute path to the file to read" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-based)" })),
  limit: Type.Optional(Type.Number({ description: "Max number of lines to read" })),
});

export function createReadFileTool(workDir: string): AgentTool<typeof Parameters> {
  return {
    name: "read_file",
    label: "Read File",
    description:
      "Read the contents of a file. Returns file content with line numbers. " +
      "Use offset and limit to read portions of large files.",
    parameters: Parameters,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      const target = resolve(workDir, params.path);
      if (!target.startsWith(workDir)) {
        throw new Error(`Path escapes workspace: ${params.path}`);
      }

      const raw = await readFile(target, "utf-8");
      let lines = raw.split("\n");

      const offset = (params.offset ?? 1) - 1; // 1-based to 0-based
      const limit = params.limit ?? lines.length;
      lines = lines.slice(offset, offset + limit);

      const numbered = lines
        .map((line, i) => `${String(offset + i + 1).padStart(5)} | ${line}`)
        .join("\n");

      return {
        content: [{ type: "text", text: numbered }],
        details: {},
      };
    },
  };
}
