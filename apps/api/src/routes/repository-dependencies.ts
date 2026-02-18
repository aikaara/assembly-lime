import { Elysia, t } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import { requireAuth } from "../middleware/auth";
import {
  getDependencyGraph,
  deleteDependency,
  getLatestScan,
} from "../services/repo-dependency.service";
import { dispatchDepScan } from "../lib/queue";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "repository-dependency-routes" });

export function repositoryDependencyRoutes(db: Db) {
  return new Elysia({ prefix: "/repository-dependencies" })
    .use(requireAuth)
    .get("/", async ({ auth }) => {
      const { nodes, edges } = await getDependencyGraph(db, auth!.tenantId);

      return {
        nodes: nodes.map((n) => ({
          id: String(n.id),
          connectorId: String(n.connectorId),
          owner: n.owner,
          name: n.name,
          fullName: n.fullName,
          cloneUrl: n.cloneUrl,
          defaultBranch: n.defaultBranch,
          isEnabled: n.isEnabled,
          forkOwner: n.forkOwner,
          forkFullName: n.forkFullName,
          forkCloneUrl: n.forkCloneUrl,
          forkCreatedAt: n.forkCreatedAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
        edges: edges.map((e) => ({
          id: String(e.id),
          sourceRepositoryId: String(e.sourceRepositoryId),
          targetRepositoryId: String(e.targetRepositoryId),
          dependencyType: e.dependencyType,
          confidence: e.confidence,
          detectedFrom: e.detectedFrom,
          metadata: e.metadata,
          lastScannedAt: e.lastScannedAt.toISOString(),
        })),
      };
    })
    .post("/scan", async ({ auth }) => {
      const tenantId = auth!.tenantId;
      log.info({ tenantId }, "enqueuing dependency scan");

      const handle = await dispatchDepScan(tenantId);

      return {
        message: "Dependency scan queued",
        triggerId: handle.id,
      };
    })
    .get("/scan-status", async ({ auth }) => {
      const scan = await getLatestScan(db, auth!.tenantId);
      if (!scan) return { scan: null };

      return {
        scan: {
          id: String(scan.id),
          status: scan.status,
          reposScanned: scan.reposScanned,
          depsFound: scan.depsFound,
          errorMessage: scan.errorMessage,
          startedAt: scan.startedAt?.toISOString() ?? null,
          completedAt: scan.completedAt?.toISOString() ?? null,
          createdAt: scan.createdAt.toISOString(),
        },
      };
    })
    .delete(
      "/:id",
      async ({ auth, params }) => {
        const deleted = await deleteDependency(db, auth!.tenantId, Number(params.id));
        if (!deleted) return { error: "not found" };
        return { deleted: true, id: params.id };
      },
      { params: t.Object({ id: t.String() }) }
    );
}
