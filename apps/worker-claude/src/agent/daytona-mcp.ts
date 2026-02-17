import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DaytonaWorkspace } from "@assembly-lime/shared";

/**
 * Creates an in-process MCP server that wraps Daytona SDK file/process operations.
 * The Agent SDK uses these MCP tools to interact with the remote workspace
 * instead of its built-in local filesystem tools.
 */
export function createDaytonaMcpServer(workspace: DaytonaWorkspace) {
  return createSdkMcpServer({
    name: "daytona-workspace",
    version: "1.0.0",
    tools: [
      tool(
        "daytona_read_file",
        "Read a file from the remote workspace",
        {
          path: z.string().describe("Relative path from repo root"),
        },
        async ({ path }) => {
          const content = await workspace.sandbox.fs.downloadFile(
            `${workspace.repoDir}/${path}`
          );
          return {
            content: [
              {
                type: "text" as const,
                text: Buffer.from(content).toString("utf-8"),
              },
            ],
          };
        }
      ),

      tool(
        "daytona_write_file",
        "Write or create a file in the remote workspace",
        {
          path: z.string().describe("Relative path from repo root"),
          content: z.string().describe("File content"),
        },
        async ({ path, content }) => {
          await workspace.writeFile(path, content);
          return {
            content: [{ type: "text" as const, text: `Written: ${path}` }],
          };
        }
      ),

      tool(
        "daytona_delete_file",
        "Delete a file from the remote workspace",
        {
          path: z.string().describe("Relative path from repo root"),
        },
        async ({ path }) => {
          await workspace.deleteFile(path);
          return {
            content: [{ type: "text" as const, text: `Deleted: ${path}` }],
          };
        }
      ),

      tool(
        "daytona_exec",
        "Run a shell command in the remote workspace",
        {
          command: z.string().describe("Shell command to execute"),
        },
        async ({ command }) => {
          const result = await workspace.exec(
            `cd ${workspace.repoDir} && ${command}`
          );
          return {
            content: [{ type: "text" as const, text: result.stdout }],
          };
        }
      ),

      tool(
        "daytona_list_files",
        "List files in a directory of the remote workspace",
        {
          path: z
            .string()
            .default(".")
            .describe("Relative directory path from repo root"),
        },
        async ({ path }) => {
          const result = await workspace.exec(
            `find ${workspace.repoDir}/${path} -maxdepth 2 -type f | head -100`
          );
          return {
            content: [{ type: "text" as const, text: result.stdout }],
          };
        }
      ),
    ],
  });
}
