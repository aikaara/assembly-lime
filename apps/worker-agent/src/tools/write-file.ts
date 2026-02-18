import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@assembly-lime/pi-agent";
import { resolve, dirname } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

const Parameters = Type.Object({
  path: Type.String({ description: "Relative or absolute path to the file to write" }),
  content: Type.String({ description: "The full content to write to the file" }),
});

export function createWriteFileTool(workDir: string): AgentTool<typeof Parameters> {
  return {
    name: "write_file",
    label: "Write File",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. " +
      "Parent directories are created automatically.",
    parameters: Parameters,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      const target = resolve(workDir, params.path);
      if (!target.startsWith(workDir)) {
        throw new Error(`Path escapes workspace: ${params.path}`);
      }

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, params.content, "utf-8");

      return {
        content: [{ type: "text", text: `Wrote ${params.content.length} bytes to ${params.path}` }],
        details: {},
      };
    },
  };
}
