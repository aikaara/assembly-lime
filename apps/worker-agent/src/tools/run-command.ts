import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@assembly-lime/pi-agent";

const Parameters = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default: 30000)" })),
});

const DEFAULT_TIMEOUT = 30_000;
const MAX_OUTPUT = 50_000; // chars

export function createRunCommandTool(workDir: string): AgentTool<typeof Parameters> {
  return {
    name: "run_command",
    label: "Run Command",
    description:
      "Execute a shell command in the workspace directory. " +
      "Output is captured and returned. Use for running tests, builds, linters, etc.",
    parameters: Parameters,
    async execute(_toolCallId, params, signal): Promise<AgentToolResult<{}>> {
      const timeout = params.timeout ?? DEFAULT_TIMEOUT;

      const proc = Bun.spawn(["bash", "-c", params.command], {
        cwd: workDir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: process.env.HOME ?? "/root" },
      });

      // Timeout handling
      const timer = setTimeout(() => proc.kill(), timeout);

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      clearTimeout(timer);

      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += (output ? "\n--- stderr ---\n" : "") + stderr;
      output += `\n[exit code: ${exitCode}]`;

      if (output.length > MAX_OUTPUT) {
        output = output.slice(0, MAX_OUTPUT) + `\n...(truncated at ${MAX_OUTPUT} chars)`;
      }

      return {
        content: [{ type: "text", text: output }],
        details: {},
      };
    },
  };
}
