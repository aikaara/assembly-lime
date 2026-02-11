import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { tenants } from "@assembly-lime/shared/db/schema";
import { requireAuth } from "../middleware/auth";
import {
  registerCluster,
  listClusters,
  syncCluster,
  deleteCluster,
} from "../services/k8s-cluster.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "k8s-cluster-routes" });

async function getTenantSlug(db: Db, tenantId: number): Promise<string> {
  const [tenant] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw new Error("Tenant not found");
  return tenant.slug;
}

export function k8sClusterRoutes(db: Db) {
  return new Elysia({ prefix: "/k8s-clusters" })
    .use(requireAuth)
    .post(
      "/",
      async ({ auth, body }) => {
        log.info({ tenantId: auth!.tenantId, name: body.name }, "registering k8s cluster");
        const slug = await getTenantSlug(db, auth!.tenantId);
        const row = await registerCluster(db, auth!.tenantId, {
          name: body.name,
          apiUrl: body.apiUrl,
          kubeconfig: body.kubeconfig,
          authType: body.authType,
          tenantSlug: slug,
        });
        return {
          id: String(row.id),
          name: row.name,
          apiUrl: row.apiUrl,
          status: row.status,
          authType: row.authType,
          metadataJson: row.metadataJson,
          createdAt: row.createdAt.toISOString(),
        };
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          apiUrl: t.Optional(t.String({ minLength: 1 })),
          kubeconfig: t.Optional(t.String()),
          authType: t.Optional(t.Number()),
        }),
      }
    )
    .get("/", async ({ auth }) => {
      const rows = await listClusters(db, auth!.tenantId);
      return rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        apiUrl: r.apiUrl,
        status: r.status,
        authType: r.authType,
        metadataJson: r.metadataJson,
        lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
    })
    .get(
      "/:id",
      async ({ auth, params }) => {
        const rows = await listClusters(db, auth!.tenantId);
        const row = rows.find((r) => r.id === Number(params.id));
        if (!row) return { error: "not found" };
        return {
          id: String(row.id),
          name: row.name,
          apiUrl: row.apiUrl,
          status: row.status,
          authType: row.authType,
          metadataJson: row.metadataJson,
          lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        };
      },
      { params: t.Object({ id: t.String() }) }
    )
    .post(
      "/:id/sync",
      async ({ auth, params }) => {
        log.info({ tenantId: auth!.tenantId, clusterId: params.id }, "syncing cluster");
        const row = await syncCluster(db, auth!.tenantId, Number(params.id));
        if (!row) return { error: "not found" };
        return {
          id: String(row.id),
          status: row.status,
          metadataJson: row.metadataJson,
          lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        };
      },
      { params: t.Object({ id: t.String() }) }
    )
    .delete(
      "/:id",
      async ({ auth, params }) => {
        const slug = await getTenantSlug(db, auth!.tenantId);
        const row = await deleteCluster(db, auth!.tenantId, Number(params.id), slug);
        if (!row) return { error: "not found" };
        return { id: String(row.id), deleted: true };
      },
      { params: t.Object({ id: t.String() }) }
    );
}
