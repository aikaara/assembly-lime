import { Elysia, t } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import { requireAuth } from "../middleware/auth";
import {
  listProjects,
  getProject,
  createProject,
  getBoard,
  createTicket,
} from "../services/project.service";

export function projectRoutes(db: Db) {
  return new Elysia({ prefix: "/projects" })
    .use(requireAuth)

    .get("/", async ({ auth }) => {
      const rows = await listProjects(db, auth!.tenantId);
      return rows.map((p) => ({
        id: String(p.id),
        name: p.name,
        key: p.key,
        createdAt: p.createdAt.toISOString(),
      }));
    })

    .post(
      "/",
      async ({ auth, body }) => {
        const project = await createProject(db, auth!.tenantId, body);
        return {
          id: String(project.id),
          name: project.name,
          key: project.key,
          createdAt: project.createdAt.toISOString(),
        };
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          key: t.String({ minLength: 1, maxLength: 10 }),
        }),
      },
    )

    .get(
      "/:id",
      async ({ auth, params }) => {
        const project = await getProject(
          db,
          auth!.tenantId,
          Number(params.id),
        );
        if (!project) return { error: "not found" };
        return {
          id: String(project.id),
          name: project.name,
          key: project.key,
          createdAt: project.createdAt.toISOString(),
        };
      },
      { params: t.Object({ id: t.String() }) },
    )

    .get(
      "/:id/board",
      async ({ auth, params }) => {
        const result = await getBoard(
          db,
          auth!.tenantId,
          Number(params.id),
        );
        if (!result) return { error: "no board found" };
        return result;
      },
      { params: t.Object({ id: t.String() }) },
    )

    .post(
      "/:id/tickets",
      async ({ auth, params, body }) => {
        return createTicket(
          db,
          auth!.tenantId,
          Number(params.id),
          body,
          auth!.userId,
        );
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          title: t.String({ minLength: 1 }),
          descriptionMd: t.Optional(t.String()),
          columnKey: t.Optional(t.String()),
          priority: t.Optional(t.Number()),
          labelsJson: t.Optional(t.Array(t.String())),
        }),
      },
    );
}
