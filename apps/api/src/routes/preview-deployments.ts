import { Elysia, t } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import {
  createPreviewDeployment,
  destroyPreviewDeployment,
  listPreviewDeployments,
} from "../services/preview-deploy.service";

export function previewDeploymentRoutes(db: Db) {
  return new Elysia({ prefix: "/preview-deployments" })
    .post(
      "/",
      async ({ body }) => {
        const row = await createPreviewDeployment(db, {
          tenantId: body.tenantId,
          agentRunId: body.agentRunId,
          repositoryId: body.repositoryId,
          branch: body.branch,
          featureSlug: body.featureSlug,
          appImage: body.appImage,
        });
        return {
          id: String(row.id),
          previewUrl: row.previewUrl,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
        };
      },
      {
        body: t.Object({
          tenantId: t.Number(),
          agentRunId: t.Optional(t.Number()),
          repositoryId: t.Number(),
          branch: t.String(),
          featureSlug: t.Optional(t.String()),
          appImage: t.String(),
        }),
      }
    )
    .get(
      "/",
      async ({ query }) => {
        const tenantId = Number(query.tenantId);
        const rows = await listPreviewDeployments(db, tenantId);
        return rows.map((r) => ({
          id: String(r.id),
          repositoryId: String(r.repositoryId),
          branch: r.branch,
          featureSlug: r.featureSlug,
          previewUrl: r.previewUrl,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          destroyedAt: r.destroyedAt?.toISOString() ?? null,
        }));
      },
      { query: t.Object({ tenantId: t.String() }) }
    )
    .delete(
      "/:id",
      async ({ params, query }) => {
        const tenantId = Number(query.tenantId);
        const result = await destroyPreviewDeployment(db, tenantId, Number(params.id));
        if (!result) return { error: "not found" };
        return { id: String(result.id), status: result.status };
      },
      {
        params: t.Object({ id: t.String() }),
        query: t.Object({ tenantId: t.String() }),
      }
    );
}
