import { eq, and, desc } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import {
  agentRunRepos,
  featureRepositoryMap,
  repositories,
  projectRepositories,
} from "@assembly-lime/shared/db/schema";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "multi-repo-service" });

export type RepoInfo = {
  repositoryId: number;
  connectorId: number;
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  repoRole?: number;
  isPrimary?: boolean;
  notes?: string;
};

export function repoRoleLabel(role?: number): string | undefined {
  const map: Record<number, string> = {
    10: "backend",
    20: "frontend",
    30: "web_sdk",
    31: "ios_sdk",
    32: "android_sdk",
    50: "infra",
  };
  return role != null ? map[role] : undefined;
}

export async function resolveReposForRun(
  db: Db,
  tenantId: number,
  projectId: number,
  featureId?: number
): Promise<RepoInfo[]> {
  if (featureId) {
    // Look up feature_repository_map
    const mapped = await db
      .select({
        repositoryId: featureRepositoryMap.repositoryId,
        connectorId: repositories.connectorId,
        owner: repositories.owner,
        name: repositories.name,
        fullName: repositories.fullName,
        cloneUrl: repositories.cloneUrl,
        defaultBranch: repositories.defaultBranch,
      })
      .from(featureRepositoryMap)
      .innerJoin(repositories, eq(featureRepositoryMap.repositoryId, repositories.id))
      .where(
        and(
          eq(featureRepositoryMap.tenantId, tenantId),
          eq(featureRepositoryMap.featureId, featureId)
        )
      );

    if (mapped.length > 0) return mapped;
  }

  // Fallback: use project_repositories
  const projRepos = await db
    .select({
      repositoryId: projectRepositories.repositoryId,
      connectorId: repositories.connectorId,
      owner: repositories.owner,
      name: repositories.name,
      fullName: repositories.fullName,
      cloneUrl: repositories.cloneUrl,
      defaultBranch: repositories.defaultBranch,
      repoRole: projectRepositories.repoRole,
      isPrimary: projectRepositories.isPrimary,
      notes: projectRepositories.notes,
    })
    .from(projectRepositories)
    .innerJoin(repositories, eq(projectRepositories.repositoryId, repositories.id))
    .where(
      and(
        eq(projectRepositories.tenantId, tenantId),
        eq(projectRepositories.projectId, projectId)
      )
    );

  if (projRepos.length > 0) return projRepos;

  // Final fallback: most recently updated tenant repos (capped to 10 to avoid cloning 80+ repos)
  const tenantRepos = await db
    .select({
      repositoryId: repositories.id,
      connectorId: repositories.connectorId,
      owner: repositories.owner,
      name: repositories.name,
      fullName: repositories.fullName,
      cloneUrl: repositories.cloneUrl,
      defaultBranch: repositories.defaultBranch,
    })
    .from(repositories)
    .where(
      and(
        eq(repositories.tenantId, tenantId),
        eq(repositories.isEnabled, true)
      )
    )
    .orderBy(desc(repositories.createdAt))
    .limit(10);

  log.info({ tenantId, projectId, fallbackCount: tenantRepos.length }, "using capped tenant repos fallback");
  return tenantRepos;
}

export async function createMultiRepoRun(
  db: Db,
  tenantId: number,
  agentRunId: number,
  repos: Array<{ repositoryId: number; branch: string }>
) {
  const rows = [];
  for (const r of repos) {
    const [row] = await db
      .insert(agentRunRepos)
      .values({
        tenantId,
        agentRunId,
        repositoryId: r.repositoryId,
        branch: r.branch,
        status: "pending",
      })
      .returning();
    rows.push(row!);
  }

  log.info({ agentRunId, repoCount: rows.length }, "multi-repo run repos created");
  return rows;
}

export async function updateRepoStatus(
  db: Db,
  agentRunId: number,
  repositoryId: number,
  status: string,
  diffSummary?: string
) {
  const [row] = await db
    .update(agentRunRepos)
    .set({ status, diffSummary })
    .where(
      and(
        eq(agentRunRepos.agentRunId, agentRunId),
        eq(agentRunRepos.repositoryId, repositoryId)
      )
    )
    .returning();
  return row ?? null;
}

export async function listRunRepos(db: Db, agentRunId: number) {
  return db
    .select()
    .from(agentRunRepos)
    .where(eq(agentRunRepos.agentRunId, agentRunId));
}
