import { Elysia, t } from "elysia";
import { eq, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { projectRepositories, repositories } from "@assembly-lime/shared/db/schema";
import { requireAuth } from "../middleware/auth";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "project-repo-routes" });

export function projectRepoRoutes(db: Db) {
  return new Elysia({ prefix: "/projects/:id/repositories" })
    .use(requireAuth)
    .get(
      "/",
      async ({ auth, params }) => {
        const rows = await db
          .select({
            id: projectRepositories.id,
            projectId: projectRepositories.projectId,
            repositoryId: projectRepositories.repositoryId,
            repoRole: projectRepositories.repoRole,
            isPrimary: projectRepositories.isPrimary,
            uatBranch: projectRepositories.uatBranch,
            prodBranch: projectRepositories.prodBranch,
            notes: projectRepositories.notes,
            createdAt: projectRepositories.createdAt,
            repoOwner: repositories.owner,
            repoName: repositories.name,
            repoFullName: repositories.fullName,
            cloneUrl: repositories.cloneUrl,
            defaultBranch: repositories.defaultBranch,
          })
          .from(projectRepositories)
          .innerJoin(repositories, eq(projectRepositories.repositoryId, repositories.id))
          .where(
            and(
              eq(projectRepositories.tenantId, auth!.tenantId),
              eq(projectRepositories.projectId, Number(params.id))
            )
          );
        return rows.map((r) => ({
          id: String(r.id),
          projectId: String(r.projectId),
          repositoryId: String(r.repositoryId),
          repoRole: r.repoRole,
          isPrimary: r.isPrimary,
          uatBranch: r.uatBranch,
          prodBranch: r.prodBranch,
          notes: r.notes,
          createdAt: r.createdAt.toISOString(),
          repoOwner: r.repoOwner,
          repoName: r.repoName,
          repoFullName: r.repoFullName,
          cloneUrl: r.cloneUrl,
          defaultBranch: r.defaultBranch,
        }));
      },
      { params: t.Object({ id: t.String() }) }
    )
    .post(
      "/",
      async ({ auth, params, body }) => {
        log.info({ tenantId: auth!.tenantId, projectId: params.id, repositoryId: body.repositoryId }, "linking repo to project");
        const [row] = await db
          .insert(projectRepositories)
          .values({
            tenantId: auth!.tenantId,
            projectId: Number(params.id),
            repositoryId: body.repositoryId,
            repoRole: body.repoRole,
            isPrimary: body.isPrimary ?? false,
            uatBranch: body.uatBranch,
            prodBranch: body.prodBranch,
            notes: body.notes,
          })
          .returning();
        return {
          id: String(row!.id),
          projectId: String(row!.projectId),
          repositoryId: String(row!.repositoryId),
          repoRole: row!.repoRole,
          isPrimary: row!.isPrimary,
          uatBranch: row!.uatBranch,
          prodBranch: row!.prodBranch,
        };
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          repositoryId: t.Number(),
          repoRole: t.Number(),
          isPrimary: t.Optional(t.Boolean()),
          uatBranch: t.Optional(t.String()),
          prodBranch: t.Optional(t.String()),
          notes: t.Optional(t.String()),
        }),
      }
    )
    .patch(
      "/:repoId",
      async ({ auth, params, body }) => {
        const updates: Record<string, unknown> = {};
        if (body.repoRole !== undefined) updates.repoRole = body.repoRole;
        if (body.isPrimary !== undefined) updates.isPrimary = body.isPrimary;
        if (body.uatBranch !== undefined) updates.uatBranch = body.uatBranch;
        if (body.prodBranch !== undefined) updates.prodBranch = body.prodBranch;
        if (body.notes !== undefined) updates.notes = body.notes;

        const [row] = await db
          .update(projectRepositories)
          .set(updates)
          .where(
            and(
              eq(projectRepositories.id, Number(params.repoId)),
              eq(projectRepositories.tenantId, auth!.tenantId),
              eq(projectRepositories.projectId, Number(params.id))
            )
          )
          .returning();
        if (!row) return { error: "not found" };
        return {
          id: String(row.id),
          repoRole: row.repoRole,
          isPrimary: row.isPrimary,
          uatBranch: row.uatBranch,
          prodBranch: row.prodBranch,
        };
      },
      {
        params: t.Object({ id: t.String(), repoId: t.String() }),
        body: t.Object({
          repoRole: t.Optional(t.Number()),
          isPrimary: t.Optional(t.Boolean()),
          uatBranch: t.Optional(t.String()),
          prodBranch: t.Optional(t.String()),
          notes: t.Optional(t.String()),
        }),
      }
    )
    .delete(
      "/:repoId",
      async ({ auth, params }) => {
        const [row] = await db
          .delete(projectRepositories)
          .where(
            and(
              eq(projectRepositories.id, Number(params.repoId)),
              eq(projectRepositories.tenantId, auth!.tenantId),
              eq(projectRepositories.projectId, Number(params.id))
            )
          )
          .returning();
        if (!row) return { error: "not found" };
        return { id: String(row.id), deleted: true };
      },
      { params: t.Object({ id: t.String(), repoId: t.String() }) }
    );
}
