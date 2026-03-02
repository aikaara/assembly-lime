import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { repoIndexStatus, repositories } from "@assembly-lime/shared/db/schema";
import { createEmbeddingProvider } from "@assembly-lime/shared";
import { dispatchCodeSearchIndex } from "../lib/queue";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "code-search-service" });

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost:3434").replace(/\/$/, "");
const INTERNAL_KEY = process.env.INTERNAL_AGENT_API_KEY ?? "";

export interface CodeSearchResult {
  id: string;
  repositoryId: string;
  repoFullName: string;
  filePath: string;
  chunkType: string;
  symbolName: string | null;
  language: string;
  startLine: number;
  endLine: number;
  content: string;
  contextHeader: string | null;
  commitSha: string | null;
  similarity: number;
}

export interface SearchFilters {
  repositoryId?: number;
  language?: string;
  chunkType?: string;
  limit?: number;
}

export async function searchCode(
  db: Db,
  tenantId: number,
  query: string,
  filters?: SearchFilters,
): Promise<CodeSearchResult[]> {
  const provider = createEmbeddingProvider();
  const [embedding] = await provider.generateEmbeddings([query], "query");
  if (!embedding) throw new Error("Failed to generate query embedding");

  const params = new URLSearchParams({
    tenantId: String(tenantId),
    queryEmbedding: JSON.stringify(embedding),
  });

  if (filters?.repositoryId) params.set("repositoryId", String(filters.repositoryId));
  if (filters?.language) params.set("language", filters.language);
  if (filters?.chunkType) params.set("chunkType", filters.chunkType);
  if (filters?.limit) params.set("limit", String(filters.limit));

  const res = await fetch(`${API_BASE_URL}/internal/code-search?${params}`, {
    headers: { "x-internal-key": INTERNAL_KEY },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Code search failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { results: CodeSearchResult[] };

  // Filter results with similarity > 0.3
  return data.results.filter((r) => r.similarity > 0.3);
}

export async function getIndexStatuses(db: Db, tenantId: number) {
  const rows = await db
    .select({
      id: repoIndexStatus.id,
      repositoryId: repoIndexStatus.repositoryId,
      status: repoIndexStatus.status,
      lastIndexedSha: repoIndexStatus.lastIndexedSha,
      lastIndexedAt: repoIndexStatus.lastIndexedAt,
      fileCount: repoIndexStatus.fileCount,
      chunkCount: repoIndexStatus.chunkCount,
      error: repoIndexStatus.error,
      repoFullName: repositories.fullName,
    })
    .from(repoIndexStatus)
    .innerJoin(repositories, eq(repositories.id, repoIndexStatus.repositoryId))
    .where(eq(repoIndexStatus.tenantId, tenantId));

  return rows.map((r) => ({
    id: String(r.id),
    repositoryId: String(r.repositoryId),
    repoFullName: r.repoFullName,
    status: r.status,
    lastIndexedSha: r.lastIndexedSha,
    lastIndexedAt: r.lastIndexedAt?.toISOString() ?? null,
    fileCount: r.fileCount,
    chunkCount: r.chunkCount,
    error: r.error,
  }));
}

export async function triggerReindex(db: Db, tenantId: number, repositoryId: number) {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.id, repositoryId), eq(repositories.tenantId, tenantId)));

  if (!repo) throw new Error("Repository not found");

  // Check for existing index status to get lastIndexedSha
  const [existing] = await db
    .select({ lastIndexedSha: repoIndexStatus.lastIndexedSha })
    .from(repoIndexStatus)
    .where(
      and(
        eq(repoIndexStatus.tenantId, tenantId),
        eq(repoIndexStatus.repositoryId, repositoryId),
      )
    );

  await dispatchCodeSearchIndex({
    tenantId,
    repositoryId,
    repoFullName: repo.fullName,
    cloneUrl: repo.cloneUrl,
    defaultBranch: repo.defaultBranch,
    connectorId: repo.connectorId,
    lastIndexedSha: existing?.lastIndexedSha ?? undefined,
  });

  return { dispatched: true };
}

export async function triggerReindexAll(db: Db, tenantId: number) {
  const repos = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.tenantId, tenantId), eq(repositories.isEnabled, true)));

  let dispatched = 0;
  for (const repo of repos) {
    try {
      const [existing] = await db
        .select({ lastIndexedSha: repoIndexStatus.lastIndexedSha })
        .from(repoIndexStatus)
        .where(
          and(
            eq(repoIndexStatus.tenantId, tenantId),
            eq(repoIndexStatus.repositoryId, repo.id),
          )
        );

      await dispatchCodeSearchIndex({
        tenantId,
        repositoryId: repo.id,
        repoFullName: repo.fullName,
        cloneUrl: repo.cloneUrl,
        defaultBranch: repo.defaultBranch,
        connectorId: repo.connectorId,
        lastIndexedSha: existing?.lastIndexedSha ?? undefined,
      });
      dispatched++;
    } catch (err) {
      log.warn({ repositoryId: repo.id, err }, "failed to dispatch reindex");
    }
  }

  return { dispatched, total: repos.length };
}
