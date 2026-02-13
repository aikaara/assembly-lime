import { eq, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { repositories, connectors, tenants } from "@assembly-lime/shared/db/schema";
import { getConnectorToken } from "./connector.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "fork-service" });

const GITHUB_API = "https://api.github.com";

type ForkInfo = {
  forkOwner: string;
  forkFullName: string;
  forkCloneUrl: string;
  forkCreatedAt: string;
};

export async function ensureFork(
  db: Db,
  tenantId: number,
  repositoryId: number
): Promise<ForkInfo> {
  // Check if repo already has fork info
  const [repo] = await db
    .select()
    .from(repositories)
    .where(
      and(eq(repositories.id, repositoryId), eq(repositories.tenantId, tenantId))
    );

  if (!repo) throw new Error("Repository not found");

  // If fork already exists, return it
  if (repo.forkOwner && repo.forkFullName && repo.forkCloneUrl) {
    return {
      forkOwner: repo.forkOwner,
      forkFullName: repo.forkFullName,
      forkCloneUrl: repo.forkCloneUrl,
      forkCreatedAt: repo.forkCreatedAt?.toISOString() ?? new Date().toISOString(),
    };
  }

  // Get tenant's fork target org
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId));

  if (!tenant) throw new Error("Tenant not found");

  const forkTargetOrg = tenant.forkTargetOrg;

  // Get connector token
  const [connector] = await db
    .select()
    .from(connectors)
    .where(
      and(eq(connectors.id, repo.connectorId), eq(connectors.tenantId, tenantId))
    );

  if (!connector) throw new Error("Connector not found");
  const token = getConnectorToken(connector);

  // Create fork on GitHub
  const forkBody: Record<string, unknown> = {};
  if (forkTargetOrg) {
    forkBody.organization = forkTargetOrg;
  }

  const res = await fetch(
    `${GITHUB_API}/repos/${repo.owner}/${repo.name}/forks`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(forkBody),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    log.error(
      { status: res.status, body: text, repoId: repositoryId },
      "failed to create GitHub fork"
    );
    throw new Error(`GitHub fork creation failed (${res.status}): ${text}`);
  }

  const fork = (await res.json()) as {
    owner: { login: string };
    full_name: string;
    clone_url: string;
    created_at: string;
  };

  const forkInfo: ForkInfo = {
    forkOwner: fork.owner.login,
    forkFullName: fork.full_name,
    forkCloneUrl: fork.clone_url,
    forkCreatedAt: fork.created_at,
  };

  // Update repo row with fork info
  await db
    .update(repositories)
    .set({
      forkOwner: forkInfo.forkOwner,
      forkFullName: forkInfo.forkFullName,
      forkCloneUrl: forkInfo.forkCloneUrl,
      forkCreatedAt: new Date(forkInfo.forkCreatedAt),
    })
    .where(eq(repositories.id, repositoryId));

  log.info(
    { tenantId, repositoryId, forkFullName: forkInfo.forkFullName },
    "fork created"
  );

  return forkInfo;
}

export async function getForkStatus(
  db: Db,
  tenantId: number,
  repositoryId: number
): Promise<ForkInfo | null> {
  const [repo] = await db
    .select({
      forkOwner: repositories.forkOwner,
      forkFullName: repositories.forkFullName,
      forkCloneUrl: repositories.forkCloneUrl,
      forkCreatedAt: repositories.forkCreatedAt,
    })
    .from(repositories)
    .where(
      and(eq(repositories.id, repositoryId), eq(repositories.tenantId, tenantId))
    );

  if (!repo || !repo.forkOwner) return null;

  return {
    forkOwner: repo.forkOwner,
    forkFullName: repo.forkFullName!,
    forkCloneUrl: repo.forkCloneUrl!,
    forkCreatedAt: repo.forkCreatedAt?.toISOString() ?? "",
  };
}
