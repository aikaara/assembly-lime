import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { tenants } from "@assembly-lime/shared/db/schema";
import { requireAuth } from "../middleware/auth";
import {
  createSandbox,
  getSandbox,
  listSandboxes,
  destroySandbox,
  getSandboxLogs,
} from "../services/sandbox.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "sandbox-routes" });

async function getTenantSlug(db: Db, tenantId: number): Promise<string> {
  const [tenant] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw new Error("Tenant not found");
  return tenant.slug;
}

function serializeSandbox(r: any) {
  return {
    id: String(r.id),
    repositoryId: String(r.repositoryId),
    clusterId: r.clusterId ? String(r.clusterId) : null,
    branch: r.branch,
    k8sNamespace: r.k8sNamespace,
    k8sPod: r.k8sPod,
    k8sService: r.k8sService ?? null,
    k8sIngress: r.k8sIngress ?? null,
    sandboxUrl: r.sandboxUrl ?? null,
    status: r.status,
    portsJson: r.portsJson,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    destroyedAt: r.destroyedAt instanceof Date ? r.destroyedAt.toISOString() : r.destroyedAt ?? null,
  };
}

export function sandboxRoutes(db: Db) {
  return new Elysia({ prefix: "/sandboxes" })
    .use(requireAuth)
    .post(
      "/",
      async ({ auth, body }) => {
        log.info({ tenantId: auth!.tenantId, repositoryId: body.repositoryId, branch: body.branch, clusterId: body.clusterId }, "creating sandbox");
        const slug = await getTenantSlug(db, auth!.tenantId);
        const row = await createSandbox(db, auth!.tenantId, {
          repositoryId: body.repositoryId,
          branch: body.branch,
          clusterId: body.clusterId,
          tenantSlug: slug,
          envVarSetId: body.envVarSetId,
          createdBy: auth!.userId,
        });
        return serializeSandbox(row);
      },
      {
        body: t.Object({
          repositoryId: t.Number(),
          branch: t.String({ minLength: 1 }),
          clusterId: t.Number(),
          envVarSetId: t.Optional(t.Number()),
        }),
      }
    )
    .get("/", async ({ auth }) => {
      const rows = await listSandboxes(db, auth!.tenantId);
      return rows.map(serializeSandbox);
    })
    .get(
      "/:id",
      async ({ auth, params }) => {
        const row = await getSandbox(db, auth!.tenantId, Number(params.id));
        if (!row) return { error: "not found" };
        return serializeSandbox(row);
      },
      { params: t.Object({ id: t.String() }) }
    )
    .get(
      "/:id/logs",
      async ({ auth, params }) => {
        const logs = await getSandboxLogs(db, auth!.tenantId, Number(params.id));
        return { logs: logs ?? "" };
      },
      { params: t.Object({ id: t.String() }) }
    )
    .delete(
      "/:id",
      async ({ auth, params }) => {
        const row = await destroySandbox(db, auth!.tenantId, Number(params.id));
        if (!row) return { error: "not found" };
        log.info({ sandboxId: params.id, tenantId: auth!.tenantId }, "sandbox destroyed");
        return { id: String(row.id), status: row.status };
      },
      { params: t.Object({ id: t.String() }) }
    );
}
