import { Elysia, t } from "elysia";
import { eq, and, gt, sql } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import type { Db } from "@assembly-lime/shared/db";
import { agentEvents, agentRuns, llmCallDumps, agentRunRepos, codeDiffs, tickets, sandboxCache } from "@assembly-lime/shared/db/schema";
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
          } else if (event.status === "awaiting_approval" || event.status === "awaiting_followup" || event.status === "awaiting_env_vars") {
            // Don't set endedAt — run is still alive
            if (event.message) {
              updates.outputSummary = event.message;
            }
          }
          await db.update(agentRuns).set(updates).where(eq(agentRuns.id, runId));

          // Chain progression: on completed, advance to next step if chain is configured
          if (event.status === "completed") {
            try {
              const { progressChain } = await import("../services/chain.service");
              await progressChain(db, runId);
            } catch (err) {
              log.warn({ err, runId }, "chain progression failed (non-fatal)");
            }
          }

          // Auto-approve: if the run's chain step has autoApprove, complete the wait token
          if (event.status === "awaiting_approval") {
            try {
              const [currentRun] = await db
                .select({ chainConfig: agentRuns.chainConfig, approvalTokenId: agentRuns.approvalTokenId })
                .from(agentRuns)
                .where(eq(agentRuns.id, runId));
              if (currentRun?.chainConfig && currentRun.approvalTokenId) {
                const chain = currentRun.chainConfig as import("@assembly-lime/shared").AgentChainConfig;
                const currentStep = chain.steps[chain.currentStepIndex];
                if (currentStep?.autoApprove) {
                  log.info({ runId, stepIndex: chain.currentStepIndex }, "auto-approving chain step after 3s delay");
                  setTimeout(async () => {
                    try {
                      const { wait } = await import("@trigger.dev/sdk/v3");
                      await wait.completeToken(currentRun.approvalTokenId!, { approved: true, action: "auto" });
                    } catch (err) {
                      log.warn({ err, runId }, "auto-approve wait.completeToken failed");
                    }
                  }, 3000);
                }
              }
            } catch (err) {
              log.warn({ err, runId }, "auto-approve check failed (non-fatal)");
            }
          }
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
          log.warn({ runId }, "agent-tasks: run not found");
          set.status = 404;
          return { error: "run not found" };
        }

        if (!run.projectId) {
          log.warn({ runId }, "agent-tasks: run has no projectId — cannot create tickets");
          set.status = 400;
          return { error: "run has no projectId — cannot create tickets without a project" };
        }

        const data = body as { tasks: Array<{ title: string; description?: string }> };
        if (!data.tasks || !Array.isArray(data.tasks) || data.tasks.length === 0) {
          set.status = 400;
          return { error: "tasks array is required" };
        }

        const createdTickets: Array<{ ticketId: string; title: string }> = [];

        try {
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
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error({ runId, projectId: run.projectId, err: msg }, "agent-tasks: failed to create tickets");
          set.status = 500;
          return { error: `Failed to create tickets: ${msg}` };
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
    )
    // ── Sandbox info: persist sandbox ID for lifecycle management ──
    .post(
      "/agent-sandbox-info/:runId",
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

        const data = body as { sandboxId: string; repoDir: string };
        await db
          .update(agentRuns)
          .set({ sandboxId: data.sandboxId })
          .where(eq(agentRuns.id, runId));

        log.info({ runId, sandboxId: data.sandboxId }, "sandbox info stored");
        return { ok: true };
      },
      {
        params: t.Object({ runId: t.String() }),
      }
    )
    // ── Approval token: persist Trigger.dev wait token ID ──
    .post(
      "/agent-approval-token/:runId",
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

        const data = body as { approvalTokenId: string };
        await db
          .update(agentRuns)
          .set({ approvalTokenId: data.approvalTokenId })
          .where(eq(agentRuns.id, runId));

        log.info({ runId, approvalTokenId: data.approvalTokenId }, "approval token stored");
        return { ok: true };
      },
      {
        params: t.Object({ runId: t.String() }),
      }
    )
    // ── Session persistence: store/retrieve full conversation snapshot ──
    .post(
      "/agent-session/:runId",
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

        const data = body as { messages: unknown[] };
        if (!data.messages || !Array.isArray(data.messages)) {
          set.status = 400;
          return { error: "messages array is required" };
        }

        const [run] = await db
          .select({ id: agentRuns.id })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId));
        if (!run) {
          set.status = 404;
          return { error: "run not found" };
        }

        await db
          .update(agentRuns)
          .set({ sessionMessagesJson: data.messages })
          .where(eq(agentRuns.id, runId));

        log.info({ runId, messageCount: data.messages.length }, "session snapshot stored");
        return { ok: true };
      },
      {
        params: t.Object({ runId: t.String() }),
      }
    )
    .get(
      "/agent-session/:runId",
      async ({ request, params, set }) => {
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
          .select({ sessionMessagesJson: agentRuns.sessionMessagesJson })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId));
        if (!run) {
          set.status = 404;
          return { error: "run not found" };
        }

        return { messages: run.sessionMessagesJson ?? null };
      },
      {
        params: t.Object({ runId: t.String() }),
      }
    )
    // ── Run status: lightweight status check for worker polling ──
    .get(
      "/agent-run-status/:runId",
      async ({ request, params, set }) => {
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
          .select({ status: agentRuns.status })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId));
        if (!run) {
          set.status = 404;
          return { error: "run not found" };
        }

        return { status: run.status };
      },
      {
        params: t.Object({ runId: t.String() }),
      }
    )
    .get(
      "/user-messages/:runId",
      async ({ request, params, query, set }) => {
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

        const afterId = Number(query.after ?? "0");

        const rows = await db
          .select({
            id: agentEvents.id,
            payloadJson: agentEvents.payloadJson,
            ts: agentEvents.ts,
          })
          .from(agentEvents)
          .where(
            and(
              eq(agentEvents.agentRunId, runId),
              eq(agentEvents.type, "user_message"),
              gt(agentEvents.id, afterId),
            )
          );

        const messages = rows.map((r) => ({
          id: String(r.id),
          text: (r.payloadJson as any)?.text ?? "",
          ts: r.ts.toISOString(),
        }));

        return { messages };
      },
      {
        params: t.Object({ runId: t.String() }),
        query: t.Object({ after: t.Optional(t.String()) }),
      }
    )
    // ── Sandbox cache: query available cached sandbox for a repo ──
    .get(
      "/sandbox-cache/:repositoryId",
      async ({ request, params, query, set }) => {
        const key = request.headers.get("x-internal-key");
        if (!key || !verifyInternalKey(key)) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const repositoryId = Number(params.repositoryId);
        const tenantId = Number(query.tenantId ?? "0");
        if (Number.isNaN(repositoryId) || Number.isNaN(tenantId) || !tenantId) {
          set.status = 400;
          return { error: "invalid repositoryId or tenantId" };
        }

        // Atomically claim the first available entry
        const rows = await db
          .update(sandboxCache)
          .set({ status: "in_use", lastUsedAt: new Date() })
          .where(
            and(
              eq(sandboxCache.tenantId, tenantId),
              eq(sandboxCache.repositoryId, repositoryId),
              eq(sandboxCache.status, "available"),
            )
          )
          .returning();

        const entry = rows[0] ?? null;
        if (entry) {
          log.info({ cacheId: entry.id, sandboxId: entry.sandboxId, repositoryId }, "sandbox cache hit — claimed");
        }

        return {
          entry: entry
            ? { id: entry.id, sandboxId: entry.sandboxId, repoDir: entry.repoDir, defaultBranch: entry.defaultBranch }
            : null,
        };
      },
      {
        params: t.Object({ repositoryId: t.String() }),
        query: t.Object({ tenantId: t.Optional(t.String()) }),
      }
    )
    // ── Sandbox cache: register/upsert a sandbox for reuse ──
    .post(
      "/sandbox-cache",
      async ({ request, body, set }) => {
        const key = request.headers.get("x-internal-key");
        if (!key || !verifyInternalKey(key)) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const data = body as {
          tenantId: number;
          repositoryId: number;
          sandboxId: string;
          repoDir: string;
          defaultBranch: string;
        };

        // Upsert by sandboxId
        const existing = await db
          .select({ id: sandboxCache.id })
          .from(sandboxCache)
          .where(eq(sandboxCache.sandboxId, data.sandboxId));

        if (existing.length > 0) {
          await db
            .update(sandboxCache)
            .set({
              status: "available",
              lastUsedAt: new Date(),
              repoDir: data.repoDir,
              defaultBranch: data.defaultBranch,
            })
            .where(eq(sandboxCache.sandboxId, data.sandboxId));
          log.info({ sandboxId: data.sandboxId }, "sandbox cache updated");
        } else {
          await db.insert(sandboxCache).values({
            tenantId: data.tenantId,
            repositoryId: data.repositoryId,
            sandboxId: data.sandboxId,
            repoDir: data.repoDir,
            defaultBranch: data.defaultBranch,
            status: "available",
          });
          log.info({ sandboxId: data.sandboxId, repositoryId: data.repositoryId }, "sandbox cache entry created");
        }

        return { ok: true };
      },
      {
        body: t.Object({
          tenantId: t.Number(),
          repositoryId: t.Number(),
          sandboxId: t.String(),
          repoDir: t.String(),
          defaultBranch: t.String(),
        }),
      }
    )
    // ── Sandbox cache: expire/delete a cache entry ──
    .delete(
      "/sandbox-cache/:id",
      async ({ request, params, set }) => {
        const key = request.headers.get("x-internal-key");
        if (!key || !verifyInternalKey(key)) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const cacheId = Number(params.id);
        if (Number.isNaN(cacheId)) {
          set.status = 400;
          return { error: "invalid id" };
        }

        await db
          .update(sandboxCache)
          .set({ status: "expired" })
          .where(eq(sandboxCache.id, cacheId));

        log.info({ cacheId }, "sandbox cache entry expired");
        return { ok: true };
      },
      {
        params: t.Object({ id: t.String() }),
      }
    )
    // ── Env var submission: store user-submitted env vars on run ──
    .post(
      "/agent-env-vars/:runId",
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

        const data = body as { envVars: Record<string, string>; repositoryId?: number };

        const [run] = await db
          .select({ id: agentRuns.id, tenantId: agentRuns.tenantId, artifactsJson: agentRuns.artifactsJson })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId));
        if (!run) {
          set.status = 404;
          return { error: "run not found" };
        }

        // Store submitted env vars in artifactsJson
        const artifacts = (run.artifactsJson as Record<string, unknown>) ?? {};
        artifacts.submitted_env_vars = data.envVars;
        await db
          .update(agentRuns)
          .set({ artifactsJson: artifacts })
          .where(eq(agentRuns.id, runId));

        // Persist to env_var_sets/env_vars for future runs (if repositoryId provided)
        if (data.repositoryId) {
          try {
            const { createEnvVarSet, setEnvVar } = await import("../services/env-var.service");
            // Find or create env var set scoped to this repository
            const { envVarSets: evSets } = await import("@assembly-lime/shared/db/schema");
            const existing = await db
              .select()
              .from(evSets)
              .where(
                and(
                  eq(evSets.tenantId, run.tenantId),
                  eq(evSets.scopeType, "repository"),
                  eq(evSets.scopeId, data.repositoryId),
                )
              );

            let setId: number;
            if (existing.length > 0) {
              setId = existing[0]!.id;
            } else {
              const newSet = await createEnvVarSet(db, run.tenantId, {
                scopeType: "repository",
                scopeId: data.repositoryId,
                name: `auto-${data.repositoryId}`,
              });
              setId = newSet.id;
            }

            for (const [k, v] of Object.entries(data.envVars)) {
              if (v) {
                await setEnvVar(db, run.tenantId, setId, k, v, true);
              }
            }
            log.info({ runId, repositoryId: data.repositoryId, keyCount: Object.keys(data.envVars).length }, "env vars persisted for future runs");
          } catch (err) {
            log.warn({ err, runId }, "failed to persist env vars to env_var_sets (non-fatal)");
          }
        }

        log.info({ runId, keyCount: Object.keys(data.envVars).length }, "env vars submitted for agent run");
        return { ok: true };
      },
      {
        params: t.Object({ runId: t.String() }),
      }
    )
    // ── Env var polling: worker polls for submitted env vars ──
    .get(
      "/agent-env-vars/:runId",
      async ({ request, params, set }) => {
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
          .select({ artifactsJson: agentRuns.artifactsJson })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId));
        if (!run) {
          set.status = 404;
          return { error: "run not found" };
        }

        const artifacts = (run.artifactsJson as Record<string, unknown>) ?? {};
        const envVars = (artifacts.submitted_env_vars as Record<string, string>) ?? null;

        return { envVars };
      },
      {
        params: t.Object({ runId: t.String() }),
      }
    );
}
