import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import type { Db } from "@assembly-lime/shared/db";
import { tenants, sandboxes, repositories } from "@assembly-lime/shared/db/schema";
import { DaytonaWorkspace } from "@assembly-lime/shared";
import { requireAuth } from "../middleware/auth";
import {
  createSandbox,
  getSandbox,
  listSandboxes,
  destroySandbox,
  getSandboxLogs,
} from "../services/sandbox.service";
import { getDecryptedEnvVars } from "../services/env-var.service";
import { getConnector, getConnectorToken } from "../services/connector.service";
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
    // Internal registration endpoint for provider-created sandboxes (e.g., Daytona)
    .post(
      "/register-internal",
      async ({ request, body, set }) => {
        const key = request.headers.get("x-internal-key");
        const expected = process.env.INTERNAL_AGENT_API_KEY;
        if (
          !expected ||
          !key ||
          Buffer.byteLength(key) !== Buffer.byteLength(expected) ||
          !timingSafeEqual(Buffer.from(key), Buffer.from(expected))
        ) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const [row] = await db
          .insert(sandboxes)
          .values({
            tenantId: body.tenantId,
            clusterId: null,
            repositoryId: body.repositoryId,
            branch: body.branch,
            k8sNamespace: "daytona",
            k8sPod: body.sandboxId,
            k8sService: null,
            k8sIngress: null,
            sandboxUrl: body.previewUrl ?? null,
            status: body.status ?? "running",
            portsJson: body.ports ?? [],
            createdBy: body.createdBy ?? null,
          })
          .returning();
        return serializeSandbox(row);
      },
      {
        body: t.Object({
          tenantId: t.Number(),
          repositoryId: t.Number(),
          branch: t.String(),
          sandboxId: t.String(),
          previewUrl: t.Optional(t.String()),
          status: t.Optional(t.String()),
          ports: t.Optional(t.Array(t.Any())),
          createdBy: t.Optional(t.Number()),
        }),
      }
    )
    .use(requireAuth)
    .get("/config", () => {
      const provider = process.env.SANDBOX_PROVIDER?.toLowerCase() || "k8s";
      return { provider, isDaytona: provider === "daytona" };
    })
    .post(
      "/",
      async ({ auth, body }) => {
        const isDaytonaProvider = body.provider === "daytona" ||
          (!body.clusterId && process.env.SANDBOX_PROVIDER?.toLowerCase() === "daytona");

        log.info({ tenantId: auth!.tenantId, repositoryId: body.repositoryId, branch: body.branch, provider: isDaytonaProvider ? "daytona" : "k8s" }, "creating sandbox");

        if (isDaytonaProvider) {
          // Daytona path: create sandbox via Daytona SDK directly
          const [repo] = await db
            .select()
            .from(repositories)
            .where(eq(repositories.id, body.repositoryId));
          if (!repo) throw new Error("Repository not found");

          // Get auth token for cloning
          let authToken: string | undefined;
          try {
            const connector = await getConnector(db, auth!.tenantId, repo.connectorId);
            if (connector) authToken = getConnectorToken(connector);
          } catch {}

          const workspace = await DaytonaWorkspace.create({
            runId: 0,
            provider: "manual",
            mode: "sandbox",
            repo: {
              cloneUrl: repo.cloneUrl,
              name: repo.name ?? "repo",
              defaultBranch: repo.defaultBranch,
              ref: body.branch,
              authToken,
            },
          });

          // Inject env vars if specified
          if (body.envVarSetId) {
            try {
              const decrypted = await getDecryptedEnvVars(db, auth!.tenantId, body.envVarSetId);
              const filtered: Record<string, string> = {};
              for (const [k, v] of Object.entries(decrypted)) {
                if (v) filtered[k] = v;
              }
              if (Object.keys(filtered).length > 0) {
                await workspace.injectEnvVars(filtered);
              }
            } catch (e) {
              log.warn({ err: e }, "failed to inject env vars");
            }
          }

          // Start dev server and get preview URL
          let previewUrl: string | null = null;
          let ports: Array<{ containerPort: number; source: string; provider: string }> = [];
          try {
            const sessionId = `sandbox-${workspace.sandbox.id}`;
            const result = await workspace.startDevServer(sessionId);
            previewUrl = result.previewUrl;
            ports = [{ containerPort: result.port, source: result.portSource, provider: "daytona" }];
            log.info({ previewUrl, port: result.port }, "daytona dev server started");
          } catch (e) {
            log.warn({ err: (e as Error)?.message }, "failed to start dev server in Daytona sandbox");
          }

          // Register in DB
          const [row] = await db
            .insert(sandboxes)
            .values({
              tenantId: auth!.tenantId,
              clusterId: null,
              repositoryId: body.repositoryId,
              branch: body.branch,
              k8sNamespace: "daytona",
              k8sPod: workspace.sandbox.id,
              sandboxUrl: previewUrl,
              status: "running",
              portsJson: ports,
              envVarSetId: body.envVarSetId ?? null,
              createdBy: auth!.userId,
            })
            .returning();
          return serializeSandbox(row);
        }

        // K8s path (existing)
        if (!body.clusterId) throw new Error("clusterId is required for K8s sandboxes");
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
          clusterId: t.Optional(t.Number()),
          envVarSetId: t.Optional(t.Number()),
          provider: t.Optional(t.String()),
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
