import { Elysia, t } from "elysia";
import { eq, asc } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { agentEvents } from "@assembly-lime/shared/db/schema";
import { requireAuth } from "../middleware/auth";
import { createAgentRun, getAgentRun } from "../services/agent-run.service";

export function agentRunRoutes(db: Db) {
  return new Elysia({ prefix: "/agent-runs" })
    .use(requireAuth)
    .post(
      "/",
      async ({ auth, body }) => {
        const run = await createAgentRun(db, {
          tenantId: auth!.tenantId,
          projectId: body.projectId,
          ticketId: body.ticketId,
          provider: body.provider,
          mode: body.mode,
          prompt: body.prompt,
          repo: body.repo,
          constraints: body.constraints,
        });
        return {
          id: String(run.id),
          status: run.status,
          provider: run.provider,
          mode: run.mode,
          createdAt: run.createdAt.toISOString(),
        };
      },
      {
        body: t.Object({
          projectId: t.Number(),
          ticketId: t.Optional(t.Number()),
          provider: t.Union([t.Literal("claude"), t.Literal("codex")]),
          mode: t.Union([
            t.Literal("plan"),
            t.Literal("implement"),
            t.Literal("bugfix"),
            t.Literal("review"),
          ]),
          prompt: t.String(),
          repo: t.Optional(
            t.Object({
              repositoryId: t.Number(),
              cloneUrl: t.String(),
              defaultBranch: t.String(),
              ref: t.Optional(t.String()),
              allowedPaths: t.Optional(t.Array(t.String())),
            })
          ),
          constraints: t.Optional(
            t.Object({
              timeBudgetSec: t.Optional(t.Number()),
              maxCostCents: t.Optional(t.Number()),
              allowedTools: t.Optional(t.Array(t.String())),
            })
          ),
        }),
      }
    )
    .get(
      "/:id",
      async ({ params }) => {
        const run = await getAgentRun(db, Number(params.id));
        if (!run) return { error: "not found" };
        return {
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
        };
      },
      { params: t.Object({ id: t.String() }) }
    )
    .get(
      "/:id/events",
      async ({ params }) => {
        const runId = Number(params.id);
        const events = await db
          .select()
          .from(agentEvents)
          .where(eq(agentEvents.agentRunId, runId))
          .orderBy(asc(agentEvents.ts));

        return events.map((e) => ({
          id: String(e.id),
          type: e.type,
          payload: e.payloadJson,
          ts: e.ts.toISOString(),
        }));
      },
      { params: t.Object({ id: t.String() }) }
    );
}
