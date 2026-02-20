import { Elysia, t } from "elysia";
import { eq, and, desc, count } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { agentRuns } from "@assembly-lime/shared/db/schema";
import { requireAuth } from "../middleware/auth";

export function projectRunRoutes(db: Db) {
  return new Elysia({ prefix: "/projects/:id/runs" })
    .use(requireAuth)
    .get(
      "/",
      async ({ auth, params, query }) => {
        const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
        const offset = Math.max(Number(query.offset) || 0, 0);

        const where = and(
          eq(agentRuns.tenantId, auth!.tenantId),
          eq(agentRuns.projectId, Number(params.id))
        );

        const [rows, [{ total }]] = await Promise.all([
          db
            .select()
            .from(agentRuns)
            .where(where)
            .orderBy(desc(agentRuns.createdAt))
            .limit(limit)
            .offset(offset),
          db
            .select({ total: count() })
            .from(agentRuns)
            .where(where),
        ]);

        return {
          data: rows.map((run) => ({
            id: String(run.id),
            tenantId: String(run.tenantId),
            projectId: String(run.projectId),
            ticketId: run.ticketId ? String(run.ticketId) : null,
            provider: run.provider,
            mode: run.mode,
            status: run.status,
            inputPrompt: run.inputPrompt,
            outputSummary: run.outputSummary,
            costCents: String(run.costCents),
            createdAt: run.createdAt.toISOString(),
            startedAt: run.startedAt?.toISOString() ?? null,
            endedAt: run.endedAt?.toISOString() ?? null,
          })),
          total,
        };
      },
      {
        params: t.Object({ id: t.String() }),
        query: t.Object({
          offset: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        }),
      },
    );
}
