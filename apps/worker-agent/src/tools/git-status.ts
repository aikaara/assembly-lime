import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@assembly-lime/pi-agent";

const Parameters = Type.Object({});

export function createGitStatusTool(workDir: string): AgentTool<typeof Parameters> {
  return {
    name: "git_status",
    label: "Git Status",
    description: "Show the working tree status (git status --porcelain). " +
      "Returns a list of changed files with their status codes.",
    parameters: Parameters,
    async execute(): Promise<AgentToolResult<{}>> {
      const proc = Bun.spawn(["git", "status", "--porcelain"], {
        cwd: workDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      const text = stdout.trim() || "(working tree clean)";

      return {
        content: [{ type: "text", text: stderr ? `${text}\n${stderr}` : text }],
        details: {},
      };
    },
  };
}
