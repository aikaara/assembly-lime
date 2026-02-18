import { Elysia, t } from "elysia";
import { eq, and, desc } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { agentRuns } from "@assembly-lime/shared/db/schema";
import { requireAuth } from "../middleware/auth";

export function projectRunRoutes(db: Db) {
  return new Elysia({ prefix: "/projects/:id/runs" })
    .use(requireAuth)
    .get(
      "/",
      async ({ auth, params }) => {
        const rows = await db
          .select()
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.tenantId, auth!.tenantId),
              eq(agentRuns.projectId, Number(params.id))
            )
          )
          .orderBy(desc(agentRuns.createdAt))
          .limit(50);

        return rows.map((run) => ({
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
        }));
      },
      { params: t.Object({ id: t.String() }) },
    );
}
