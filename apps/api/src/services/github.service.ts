import { eq, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { repositories } from "@assembly-lime/shared/db/schema";
import { getConnector, getConnectorToken } from "./connector.service";
import { autoSubscribeWebhooks } from "./webhook-subscribe.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "github-service" });

const GITHUB_API = "https://api.github.com";

async function githubFetch(token: string, path: string) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

/** Extract the "next" page URL from a GitHub Link header. */
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}

/** Fetch all pages from a GitHub list endpoint, following Link headers. */
async function githubFetchAllPages<T>(token: string, initialPath: string): Promise<T[]> {
  const all: T[] = [];
  let url: string | null = `${GITHUB_API}${initialPath}`;

  while (url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${url} failed (${res.status}): ${text}`);
    }
    const page = (await res.json()) as T[];
    all.push(...page);
    url = parseNextLink(res.headers.get("link"));
  }

  return all;
}

type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  clone_url: string;
  default_branch: string;
  owner: { login: string };
  private: boolean;
  description: string | null;
  language: string | null;
  updated_at: string;
};

export async function listOrgRepos(db: Db, tenantId: number, connectorId: number) {
  const connector = await getConnector(db, tenantId, connectorId);
  if (!connector) throw new Error("Connector not found");
  const token = getConnectorToken(connector);

  const org = connector.externalOrg;
  const path = org ? `/orgs/${org}/repos?per_page=100&sort=updated` : "/user/repos?per_page=100&sort=updated";
  const repos = await githubFetchAllPages<GitHubRepo>(token, path);
  log.info({ tenantId, connectorId, repoCount: repos.length, org: org ?? "(personal)" }, "fetched all repo pages from GitHub");
  return repos;
}

export async function getRepoDetails(
  db: Db,
  tenantId: number,
  connectorId: number,
  owner: string,
  repo: string
) {
  const connector = await getConnector(db, tenantId, connectorId);
  if (!connector) throw new Error("Connector not found");
  const token = getConnectorToken(connector);
  return githubFetch(token, `/repos/${owner}/${repo}`);
}

export async function browseFileTree(
  db: Db,
  tenantId: number,
  connectorId: number,
  owner: string,
  repo: string,
  path?: string,
  ref?: string
) {
  const connector = await getConnector(db, tenantId, connectorId);
  if (!connector) throw new Error("Connector not found");
  const token = getConnectorToken(connector);

  let apiPath = `/repos/${owner}/${repo}/contents`;
  if (path) apiPath += `/${path}`;
  if (ref) apiPath += `?ref=${encodeURIComponent(ref)}`;

  return githubFetch(token, apiPath);
}

export async function getFileContent(
  db: Db,
  tenantId: number,
  connectorId: number,
  owner: string,
  repo: string,
  path: string,
  ref?: string
) {
  const connector = await getConnector(db, tenantId, connectorId);
  if (!connector) throw new Error("Connector not found");
  const token = getConnectorToken(connector);

  let apiPath = `/repos/${owner}/${repo}/contents/${path}`;
  if (ref) apiPath += `?ref=${encodeURIComponent(ref)}`;

  return githubFetch(token, apiPath);
}

type ImportRepoInput = {
  externalRepoId: number;
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
};

export async function importRepos(
  db: Db,
  tenantId: number,
  connectorId: number,
  repos: ImportRepoInput[]
) {
  const connector = await getConnector(db, tenantId, connectorId);
  if (!connector) throw new Error("Connector not found");

  const inserted = [];
  for (const r of repos) {
    const [row] = await db
      .insert(repositories)
      .values({
        tenantId,
        connectorId,
        provider: connector.provider,
        externalRepoId: r.externalRepoId,
        owner: r.owner,
        name: r.name,
        fullName: r.fullName,
        cloneUrl: r.cloneUrl,
        defaultBranch: r.defaultBranch,
      })
      .onConflictDoNothing()
      .returning();
    if (row) inserted.push(row);
  }

  log.info({ tenantId, connectorId, count: inserted.length }, "repos imported");

  // Auto-subscribe webhooks for newly imported repos (fire-and-forget)
  if (inserted.length > 0) {
    const token = getConnectorToken(connector);
    const fullNames = inserted.map((r) => r.fullName);
    autoSubscribeWebhooks(db, tenantId, connectorId, token, fullNames).catch((err) =>
      log.error({ err, tenantId }, "auto-subscribe webhooks after import failed"),
    );
  }

  return inserted;
}
