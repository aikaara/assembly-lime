import { readFileSync } from "fs";
import { logger } from "../lib/logger";
import type { AgentMode } from "@assembly-lime/shared";

const GIT_CREDENTIAL_PATH = "/etc/git-credentials/token";

export type CreatePRInput = {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft?: boolean;
  forkOwner?: string; // If set, head will be formatted as "forkOwner:branch" for cross-repo PRs
};

export type PRResult = {
  url: string;
  number: number;
};

export function readGitToken(): string {
  try {
    return readFileSync(GIT_CREDENTIAL_PATH, "utf-8").trim();
  } catch {
    throw new Error(`Failed to read git token from ${GIT_CREDENTIAL_PATH}`);
  }
}

export async function createPullRequest(
  token: string,
  input: CreatePRInput
): Promise<PRResult> {
  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/pulls`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      head: input.forkOwner ? `${input.forkOwner}:${input.head}` : input.head,
      base: input.base,
      draft: input.draft ?? false,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`GitHub PR creation failed (${response.status}): ${errBody}`);
  }

  const data = (await response.json()) as { html_url: string; number: number };
  logger.info(
    { prUrl: data.html_url, prNumber: data.number },
    "pull request created"
  );

  return { url: data.html_url, number: data.number };
}

export function buildPRTitle(mode: AgentMode, prompt: string): string {
  const truncated = prompt.length > 60 ? prompt.slice(0, 57) + "..." : prompt;
  return `[AL/${mode}] ${truncated}`;
}

export function buildPRBody(opts: {
  mode: AgentMode;
  runId: number;
  prompt: string;
  diffStats: string;
}): string {
  return [
    `## Assembly Lime Agent Run`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| **Run ID** | \`${opts.runId}\` |`,
    `| **Mode** | \`${opts.mode}\` |`,
    `| **Prompt** | ${opts.prompt} |`,
    "",
    "### Diff Stats",
    "```",
    opts.diffStats,
    "```",
    "",
    "---",
    "*Created by [Assembly Lime](https://assemblylime.dev) agent*",
  ].join("\n");
}
