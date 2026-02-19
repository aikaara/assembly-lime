import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import type { Db } from "@assembly-lime/shared/db";
import { agentEvents, agentRuns, llmCallDumps, agentRunRepos, codeDiffs, tickets } from "@assembly-lime/shared/db/schema";
import type { AgentEvent } from "@assembly-lime/shared";
import { broadcastToWs } from "./ws";
import { createTicket } from "../services/project.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "internal-events" });

const INTERNAL_KEY = process.env.INTERNAL_AGENT_API_KEY ?? "";

function verifyInternalKey(provided: string): boolean {
  if (!INTERNAL_KEY || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(INTERNAL_KEY);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function internalEventRoutes(db: Db) {
  return new Elysia({ prefix: "/internal" })
    .post(
      "/agent-events/:runId",
      async ({ request, params, body, set }) => {
        const key = request.headers.get("x-internal-key");
        if (!key || !verifyInternalKey(key)) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const runId = Number(params.runId);
        if (Number.isNaN(runId)) {
          set.status = 400;
          return { error: "invalid runId" };
        }

        const event = body as AgentEvent;

        // 1. Look up tenant from the run
        const [run] = await db
          .select({ tenantId: agentRuns.tenantId })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId));
        if (!run) {
          log.warn({ runId }, "agent event for unknown run");
          set.status = 404;
          return { error: "run not found" };
        }

        // 2. Persist event
        await db.insert(agentEvents).values({
          tenantId: run.tenantId,
          agentRunId: runId,
          type: event.type,
          payloadJson: event,
        });

        // 3. Update run status if this is a status event
        if (event.type === "status") {
          const updates: Record<string, unknown> = { status: event.status };
          if (event.status === "running") {
            updates.startedAt = new Date();
          } else if (
            event.status === "completed" ||
            event.status === "failed" ||
            event.status === "cancelled"
          ) {
            updates.endedAt = new Date();
            if (event.message) {
              updates.outputSummary = event.message;
            }
          } else if (event.status === "awaiting_approval") {
            // Don't set endedAt — run is still alive with preview
            if (event.message) {
              updates.outputSummary = event.message;
            }
          }
          await db.update(agentRuns).set(updates).where(eq(agentRuns.id, runId));
        }

        // 4. Broadcast to WebSocket
        broadcastToWs(runId, event);

        return { ok: true };
      },
      {
        params: t.Object({ runId: t.String() }),
      }
    )
    .post(
      "/llm-call-dumps/:runId",
      async ({ request, params, body, set }) => {
        const key = request.headers.get("x-internal-key");
        if (!key || !verifyInternalKey(key)) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const runId = Number(params.runId);
        if (Number.isNaN(runId)) {
          set.status = 400;
          return { error: "invalid runId" };
        }

        const dump = body as any;

        const [run] = await db
          .select({ tenantId: agentRuns.tenantId })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId));
        if (!run) {
          set.status = 404;
          return { error: "run not found" };
        }

        await db.insert(llmCallDumps).values({
          tenantId: run.tenantId,
          agentRunId: runId,
          turnNumber: dump.turnNumber ?? 0,
          model: dump.model ?? "unknown",
          provider: dump.provider ?? "unknown",
          systemPromptHash: dump.systemPromptHash ?? null,
          messagesJson: dump.messagesJson ?? null,
          responseJson: dump.responseJson ?? null,
          inputTokens: dump.inputTokens ?? 0,
          outputTokens: dump.outputTokens ?? 0,
          cacheReadTokens: dump.cacheReadTokens ?? 0,
          cacheWriteTokens: dump.cacheWriteTokens ?? 0,
          totalTokens: dump.totalTokens ?? 0,
          costCents: dump.costCents ?? 0,
          stopReason: dump.stopReason ?? null,
          durationMs: dump.durationMs ?? null,
        });

        return { ok: true };
      },
      {
        params: t.Object({ runId: t.String() }),
      }
    )
    .post(
      "/agent-run-repos/:runId",
      async ({ request, params, body, set }) => {
        const key = request.headers.get("x-internal-key");
        if (!key || !verifyInternalKey(key)) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const runId = Number(params.runId);
        if (Number.isNaN(runId)) {
          set.status = 400;
          return { error: "invalid runId" };
        }

        const data = body as any;

        const [run] = await db
          .select({ tenantId: agentRuns.tenantId })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId));
        if (!run) {
          set.status = 404;
          return { error: "run not found" };
        }

        await db.insert(agentRunRepos).values({
          tenantId: run.tenantId,
          agentRunId: runId,
          repositoryId: data.repositoryId,
          branch: data.branch,
          status: data.status ?? "pending",
          diffSummary: data.diffSummary ?? null,
        }).onConflictDoUpdate({
          target: [agentRunRepos.agentRunId, agentRunRepos.repositoryId],
          set: {
            status: data.status ?? "pending",
            diffSummary: data.diffSummary ?? null,
          },
        });

        return { ok: true };
      },
      {
        params: t.Object({ runId: t.String() }),
      }
    )
    .post(
      "/code-diffs/:runId",
      async ({ request, params, body, set }) => {
        const key = request.headers.get("x-internal-key");
        if (!key || !verifyInternalKey(key)) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const runId = Number(params.runId);
        if (Number.isNaN(runId)) {
          set.status = 400;
          return { error: "invalid runId" };
        }

        const data = body as any;

        const [run] = await db
          .select({ tenantId: agentRuns.tenantId })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId));
        if (!run) {
          set.status = 404;
          return { error: "run not found" };
        }

        await db.insert(codeDiffs).values({
          tenantId: run.tenantId,
          agentRunId: runId,
          repositoryId: data.repositoryId,
          baseRef: data.baseRef,
          headRef: data.headRef,
          unifiedDiff: data.unifiedDiff,
          summary: data.summary ?? null,
        });

        return { ok: true };
      },
      {
        params: t.Object({ runId: t.String() }),
      }
    )
    .post(
      "/agent-tasks/:runId",
      async ({ request, params, body, set }) => {
        const key = request.headers.get("x-internal-key");
        if (!key || !verifyInternalKey(key)) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const runId = Number(params.runId);
        if (Number.isNaN(runId)) {
          set.status = 400;
          return { error: "invalid runId" };
        }

        const [run] = await db
          .select({
            tenantId: agentRuns.tenantId,
            projectId: agentRuns.projectId,
            ticketId: agentRuns.ticketId,
          })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId));
        if (!run) {
          set.status = 404;
          return { error: "run not found" };
        }

        const data = body as { tasks: Array<{ title: string; description?: string }> };
        if (!data.tasks || !Array.isArray(data.tasks) || data.tasks.length === 0) {
          set.status = 400;
          return { error: "tasks array is required" };
        }

        const createdTickets: Array<{ ticketId: string; title: string }> = [];

        for (const task of data.tasks) {
          const ticket = await createTicket(
            db,
            run.tenantId,
            run.projectId,
            {
              title: task.title,
              descriptionMd: task.description,
              columnKey: "todo",
              labelsJson: ["agent-planned"],
            },
          );

          // Set parentTicketId and agentRunId on the created ticket
          await db
            .update(tickets)
            .set({
              parentTicketId: run.ticketId ?? undefined,
              agentRunId: runId,
            })
            .where(eq(tickets.id, Number(ticket.id)));

          createdTickets.push({ ticketId: ticket.id, title: ticket.title });
        }

        // Broadcast tasks event via WebSocket
        const tasksEvent: AgentEvent = {
          type: "tasks",
          tasks: createdTickets.map((t) => ({
            ticketId: t.ticketId,
            title: t.title,
            status: "pending" as const,
          })),
        };

        await db.insert(agentEvents).values({
          tenantId: run.tenantId,
          agentRunId: runId,
          type: "tasks",
          payloadJson: tasksEvent,
        });
        broadcastToWs(runId, tasksEvent);

        log.info({ runId, taskCount: createdTickets.length }, "agent tasks created");
        return { ok: true, tickets: createdTickets };
      },
      {
        params: t.Object({ runId: t.String() }),
      }
    );
}
