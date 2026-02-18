import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@assembly-lime/pi-agent";

const Parameters = Type.Object({
  staged: Type.Optional(Type.Boolean({ description: "Show only staged changes (default: false, shows all)" })),
  path: Type.Optional(Type.String({ description: "Restrict diff to a specific path" })),
});

export function createGitDiffTool(workDir: string): AgentTool<typeof Parameters> {
  return {
    name: "git_diff",
    label: "Git Diff",
    description: "Show unified diff of changes in the working tree. " +
      "Use staged=true for staged changes, or leave false for all changes.",
    parameters: Parameters,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      const args = ["git", "diff"];
      if (params.staged) args.push("--cached");
      if (params.path) args.push("--", params.path);

      const proc = Bun.spawn(args, {
        cwd: workDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const text = stdout.trim() || "(no changes)";

      return {
        content: [{ type: "text", text }],
        details: {},
      };
    },
  };
}
