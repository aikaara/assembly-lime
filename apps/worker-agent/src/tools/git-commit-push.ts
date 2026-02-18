import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@assembly-lime/pi-agent";

const Parameters = Type.Object({
  message: Type.String({ description: "Commit message" }),
  push: Type.Optional(Type.Boolean({ description: "Push to remote after commit (default: true)" })),
});

export function createGitCommitPushTool(workDir: string): AgentTool<typeof Parameters> {
  return {
    name: "git_commit_push",
    label: "Git Commit & Push",
    description:
      "Stage all changes, commit with the given message, and optionally push to the remote. " +
      "Uses `git add -A` to stage everything.",
    parameters: Parameters,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      // Stage all
      const add = Bun.spawn(["git", "add", "-A"], { cwd: workDir, stdout: "pipe", stderr: "pipe" });
      await add.exited;

      // Commit
      const commit = Bun.spawn(["git", "commit", "-m", params.message], {
        cwd: workDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const commitOut = await new Response(commit.stdout).text();
      const commitErr = await new Response(commit.stderr).text();
      const commitCode = await commit.exited;

      if (commitCode !== 0) {
        const text = commitErr || commitOut || "Commit failed";
        // "nothing to commit" is not really an error
        if (text.includes("nothing to commit")) {
          return { content: [{ type: "text", text: "Nothing to commit — working tree clean." }], details: {} };
        }
        throw new Error(`git commit failed (exit ${commitCode}): ${text}`);
      }

      let output = commitOut.trim();

      // Push
      if (params.push !== false) {
        const push = Bun.spawn(["git", "push", "--set-upstream", "origin", "HEAD"], {
          cwd: workDir,
          stdout: "pipe",
          stderr: "pipe",
        });
        const pushOut = await new Response(push.stdout).text();
        const pushErr = await new Response(push.stderr).text();
        const pushCode = await push.exited;

        if (pushCode !== 0) {
          throw new Error(`git push failed (exit ${pushCode}): ${pushErr || pushOut}`);
        }
        output += "\n" + (pushErr || pushOut).trim(); // git push writes to stderr
      }

      return {
        content: [{ type: "text", text: output }],
        details: {},
      };
    },
  };
}
