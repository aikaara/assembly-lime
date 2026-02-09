import { Elysia, t } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import { requireAuth } from "../middleware/auth";
import { getTicket, updateTicket } from "../services/project.service";

export function ticketRoutes(db: Db) {
  return new Elysia({ prefix: "/tickets" })
    .use(requireAuth)

    .get(
      "/:id",
      async ({ auth, params }) => {
        const ticket = await getTicket(
          db,
          auth!.tenantId,
          Number(params.id),
        );
        if (!ticket) return { error: "not found" };
        return ticket;
      },
      { params: t.Object({ id: t.String() }) },
    )

    .patch(
      "/:id",
      async ({ auth, params, body }) => {
        const ticket = await updateTicket(
          db,
          auth!.tenantId,
          Number(params.id),
          body,
        );
        if (!ticket) return { error: "not found" };
        return ticket;
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          title: t.Optional(t.String()),
          descriptionMd: t.Optional(t.String()),
          columnKey: t.Optional(t.String()),
          priority: t.Optional(t.Number()),
          labelsJson: t.Optional(t.Array(t.String())),
          branch: t.Optional(t.String()),
          prUrl: t.Optional(t.String()),
          assigneeUserId: t.Optional(t.Number()),
        }),
      },
    );
}
