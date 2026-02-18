import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@assembly-lime/pi-agent";

export interface PRContext {
  owner: string;
  name: string;
  defaultBranch: string;
  authToken: string;
}

const Parameters = Type.Object({
  title: Type.String({ description: "PR title" }),
  body: Type.String({ description: "PR description (markdown)" }),
  head: Type.String({ description: "Source branch name" }),
  base: Type.Optional(Type.String({ description: "Target branch (default: repo default branch)" })),
});

export function createPRTool(
  workDir: string,
  prContext: PRContext,
): AgentTool<typeof Parameters> {
  return {
    name: "create_pr",
    label: "Create Pull Request",
    description:
      "Create a GitHub pull request. Requires the source branch to be pushed. " +
      "Returns the PR URL.",
    parameters: Parameters,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      const base = params.base ?? prContext.defaultBranch;

      const res = await fetch(
        `https://api.github.com/repos/${prContext.owner}/${prContext.name}/pulls`,
        {
          method: "POST",
          headers: {
            Authorization: `token ${prContext.authToken}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: params.title,
            body: params.body,
            head: params.head,
            base,
          }),
        },
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${err}`);
      }

      const pr = (await res.json()) as { html_url: string; number: number };

      return {
        content: [{ type: "text", text: `PR #${pr.number} created: ${pr.html_url}` }],
        details: {},
      };
    },
  };
}
