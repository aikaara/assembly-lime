import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@assembly-lime/pi-agent";
import { resolve } from "node:path";

const Parameters = Type.Object({
  pattern: Type.String({ description: "Regex pattern to search for" }),
  path: Type.Optional(Type.String({ description: "Directory or file to search in (default: workspace root)" })),
  glob: Type.Optional(Type.String({ description: "File glob filter, e.g. '*.ts'" })),
  caseSensitive: Type.Optional(Type.Boolean({ description: "Case sensitive search (default: true)" })),
});

export function createSearchCodeTool(workDir: string): AgentTool<typeof Parameters> {
  return {
    name: "search_code",
    label: "Search Code",
    description:
      "Search for a regex pattern in files using grep. Returns matching lines with file paths " +
      "and line numbers. Excludes node_modules, .git, dist directories.",
    parameters: Parameters,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      const target = resolve(workDir, params.path ?? ".");
      if (!target.startsWith(workDir)) {
        throw new Error(`Path escapes workspace: ${params.path}`);
      }

      const args = [
        "grep", "-rn",
        "--exclude-dir=node_modules",
        "--exclude-dir=.git",
        "--exclude-dir=dist",
        "--exclude-dir=coverage",
      ];

      if (params.caseSensitive === false) {
        args.push("-i");
      }

      if (params.glob) {
        args.push(`--include=${params.glob}`);
      }

      args.push(params.pattern, target);

      const proc = Bun.spawn(args, { cwd: workDir, stdout: "pipe", stderr: "pipe" });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      // Make paths relative
      const lines = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => l.replace(workDir + "/", ""))
        .slice(0, 200); // cap output

      return {
        content: [{ type: "text", text: lines.join("\n") || "(no matches)" }],
        details: {},
      };
    },
  };
}
