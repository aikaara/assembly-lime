import { eq, and, desc } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import {
  repositories,
  repositoryDependencies,
  dependencyScans,
} from "@assembly-lime/shared/db/schema";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "repo-dependency-service" });

export type DependencyEdge = {
  sourceRepositoryId: number;
  targetRepositoryId: number;
  dependencyType: string;
  confidence: number;
  detectedFrom: string | null;
  metadata: Record<string, unknown>;
};

export async function getDependencyGraph(db: Db, tenantId: number) {
  const [nodes, edges] = await Promise.all([
    db
      .select()
      .from(repositories)
      .where(eq(repositories.tenantId, tenantId)),
    db
      .select()
      .from(repositoryDependencies)
      .where(eq(repositoryDependencies.tenantId, tenantId)),
  ]);

  return { nodes, edges };
}

export async function storeDependencies(
  db: Db,
  tenantId: number,
  deps: DependencyEdge[]
) {
  const now = new Date();
  let upserted = 0;

  for (const dep of deps) {
    await db
      .insert(repositoryDependencies)
      .values({
        tenantId,
        sourceRepositoryId: dep.sourceRepositoryId,
        targetRepositoryId: dep.targetRepositoryId,
        dependencyType: dep.dependencyType,
        confidence: dep.confidence,
        detectedFrom: dep.detectedFrom,
        metadata: dep.metadata,
        lastScannedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          repositoryDependencies.tenantId,
          repositoryDependencies.sourceRepositoryId,
          repositoryDependencies.targetRepositoryId,
          repositoryDependencies.dependencyType,
        ],
        set: {
          confidence: dep.confidence,
          detectedFrom: dep.detectedFrom,
          metadata: dep.metadata,
          lastScannedAt: now,
        },
      });
    upserted++;
  }

  log.info({ tenantId, upserted }, "dependencies stored");
  return upserted;
}

export async function deleteDependency(db: Db, tenantId: number, depId: number) {
  const [row] = await db
    .delete(repositoryDependencies)
    .where(
      and(
        eq(repositoryDependencies.id, depId),
        eq(repositoryDependencies.tenantId, tenantId)
      )
    )
    .returning();
  return row ?? null;
}

export async function clearDependencies(db: Db, tenantId: number) {
  await db
    .delete(repositoryDependencies)
    .where(eq(repositoryDependencies.tenantId, tenantId));
  log.info({ tenantId }, "all dependencies cleared");
}

export async function getLatestScan(db: Db, tenantId: number) {
  const [scan] = await db
    .select()
    .from(dependencyScans)
    .where(eq(dependencyScans.tenantId, tenantId))
    .orderBy(desc(dependencyScans.createdAt))
    .limit(1);
  return scan ?? null;
}
