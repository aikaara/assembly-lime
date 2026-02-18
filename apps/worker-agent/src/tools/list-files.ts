import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@assembly-lime/pi-agent";
import { resolve } from "node:path";

const Parameters = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory path to list (default: workspace root)" })),
  pattern: Type.Optional(Type.String({ description: "Glob pattern to filter files (e.g. '**/*.ts')" })),
});

export function createListFilesTool(workDir: string): AgentTool<typeof Parameters> {
  return {
    name: "list_files",
    label: "List Files",
    description:
      "List files in a directory. Uses find with sensible exclusions " +
      "(node_modules, .git, dist, coverage). Optionally filter with a glob pattern.",
    parameters: Parameters,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      const target = resolve(workDir, params.path ?? ".");
      if (!target.startsWith(workDir)) {
        throw new Error(`Path escapes workspace: ${params.path}`);
      }

      const args = [
        "find", target,
        "-not", "-path", "*/node_modules/*",
        "-not", "-path", "*/.git/*",
        "-not", "-path", "*/dist/*",
        "-not", "-path", "*/coverage/*",
        "-not", "-path", "*/.next/*",
        "-type", "f",
      ];

      if (params.pattern) {
        args.push("-name", params.pattern);
      }

      const proc = Bun.spawn(args, { cwd: workDir, stdout: "pipe", stderr: "pipe" });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      // Make paths relative to workDir
      const lines = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((p) => p.replace(workDir + "/", ""))
        .sort()
        .slice(0, 500); // cap output

      return {
        content: [{ type: "text", text: lines.join("\n") || "(no files found)" }],
        details: {},
      };
    },
  };
}
