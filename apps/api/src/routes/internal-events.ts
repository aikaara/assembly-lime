import { Elysia, t } from "elysia";
import { eq, and, gt, inArray, sql } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import type { Db } from "@assembly-lime/shared/db";
import { agentEvents, agentRuns, llmCallDumps, agentRunRepos, codeDiffs, tickets, sandboxCache, codeChunks, repoIndexStatus, repositories } from "@assembly-lime/shared/db/schema";
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
    )
    // ── Code chunks: batch upsert for code search indexing ──
    .post(
      "/code-chunks/:repositoryId",
      async ({ request, params, body, set }) => {
        const key = request.headers.get("x-internal-key");
        if (!key || !verifyInternalKey(key)) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const repositoryId = Number(params.repositoryId);
        if (Number.isNaN(repositoryId)) {
          set.status = 400;
          return { error: "invalid repositoryId" };
        }

        const data = body as {
          tenantId: number;
          commitSha: string;
          deleteFilePaths?: string[];
          chunks: Array<{
            filePath: string;
            chunkType: string;
            symbolName: string | null;
            language: string;
            startLine: number;
            endLine: number;
            content: string;
            contextHeader: string | null;
            embedding: number[];
          }>;
        };

        // Delete chunks for deleted files
        if (data.deleteFilePaths && data.deleteFilePaths.length > 0) {
          await db
            .delete(codeChunks)
            .where(
              and(
                eq(codeChunks.tenantId, data.tenantId),
                eq(codeChunks.repositoryId, repositoryId),
                inArray(codeChunks.filePath, data.deleteFilePaths),
              )
            );
        }

        // Delete existing chunks for files being re-indexed
        if (data.chunks.length > 0) {
          const filePaths = [...new Set(data.chunks.map((c) => c.filePath))];
          await db
            .delete(codeChunks)
            .where(
              and(
                eq(codeChunks.tenantId, data.tenantId),
                eq(codeChunks.repositoryId, repositoryId),
                inArray(codeChunks.filePath, filePaths),
              )
            );
        }

        // Insert new chunks using raw SQL for pgvector embedding
        for (const chunk of data.chunks) {
          const embeddingStr = `[${chunk.embedding.join(",")}]`;
          await db.execute(sql`
            INSERT INTO code_chunks (
              tenant_id, repository_id, file_path, chunk_type, symbol_name,
              language, start_line, end_line, content, context_header,
              embedding, commit_sha, created_at, updated_at
            ) VALUES (
              ${data.tenantId}, ${repositoryId}, ${chunk.filePath}, ${chunk.chunkType},
              ${chunk.symbolName}, ${chunk.language}, ${chunk.startLine}, ${chunk.endLine},
              ${chunk.content}, ${chunk.contextHeader},
              ${sql.raw(`'${embeddingStr}'::vector`)}, ${data.commitSha},
              NOW(), NOW()
            )
          `);
        }

        log.info({ repositoryId, chunkCount: data.chunks.length }, "code chunks upserted");
        return { ok: true, inserted: data.chunks.length };
      },
      {
        params: t.Object({ repositoryId: t.String() }),
      }
    )
    // ── Code chunks: full wipe for re-index ──
    .delete(
      "/code-chunks/:repositoryId",
      async ({ request, params, query, set }) => {
        const key = request.headers.get("x-internal-key");
        if (!key || !verifyInternalKey(key)) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const repositoryId = Number(params.repositoryId);
        const tenantId = Number(query.tenantId ?? "0");
        if (Number.isNaN(repositoryId) || !tenantId) {
          set.status = 400;
          return { error: "invalid repositoryId or tenantId" };
        }

        const result = await db
          .delete(codeChunks)
          .where(
            and(
              eq(codeChunks.tenantId, tenantId),
              eq(codeChunks.repositoryId, repositoryId),
            )
          );

        log.info({ repositoryId, tenantId }, "code chunks wiped for re-index");
        return { ok: true };
      },
      {
        params: t.Object({ repositoryId: t.String() }),
        query: t.Object({ tenantId: t.Optional(t.String()) }),
      }
    )
    // ── Repo index status: upsert ──
    .post(
      "/repo-index-status/:repositoryId",
      async ({ request, params, body, set }) => {
        const key = request.headers.get("x-internal-key");
        if (!key || !verifyInternalKey(key)) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const repositoryId = Number(params.repositoryId);
        if (Number.isNaN(repositoryId)) {
          set.status = 400;
          return { error: "invalid repositoryId" };
        }

        const data = body as {
          tenantId: number;
          status: string;
          lastIndexedSha?: string;
          fileCount?: number;
          chunkCount?: number;
          error?: string;
        };

        const now = new Date();
        const values: Record<string, unknown> = {
          status: data.status,
          updatedAt: now,
        };
        if (data.lastIndexedSha !== undefined) values.lastIndexedSha = data.lastIndexedSha;
        if (data.fileCount !== undefined) values.fileCount = data.fileCount;
        if (data.chunkCount !== undefined) values.chunkCount = data.chunkCount;
        if (data.error !== undefined) values.error = data.error;
        if (data.status === "ready") values.lastIndexedAt = now;

        await db
          .insert(repoIndexStatus)
          .values({
            tenantId: data.tenantId,
            repositoryId,
            status: data.status,
            lastIndexedSha: data.lastIndexedSha ?? null,
            lastIndexedAt: data.status === "ready" ? now : null,
            fileCount: data.fileCount ?? 0,
            chunkCount: data.chunkCount ?? 0,
            error: data.error ?? null,
          })
          .onConflictDoUpdate({
            target: [repoIndexStatus.tenantId, repoIndexStatus.repositoryId],
            set: values,
          });

        log.info({ repositoryId, status: data.status }, "repo index status updated");
        return { ok: true };
      },
      {
        params: t.Object({ repositoryId: t.String() }),
      }
    )
    // ── Code search: vector similarity search ──
    .get(
      "/code-search",
      async ({ request, query, set }) => {
        const key = request.headers.get("x-internal-key");
        if (!key || !verifyInternalKey(key)) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const tenantId = Number(query.tenantId);
        if (!tenantId) {
          set.status = 400;
          return { error: "tenantId is required" };
        }

        let queryEmbedding: number[];
        try {
          queryEmbedding = JSON.parse(query.queryEmbedding ?? "[]");
        } catch {
          set.status = 400;
          return { error: "invalid queryEmbedding" };
        }

        if (!queryEmbedding.length) {
          set.status = 400;
          return { error: "queryEmbedding is required" };
        }

        const limit = Math.min(50, Number(query.limit) || 10);
        const embeddingStr = `[${queryEmbedding.join(",")}]`;

        // Build WHERE clauses
        const conditions: string[] = [`cc.tenant_id = ${tenantId}`];
        if (query.repositoryId) conditions.push(`cc.repository_id = ${Number(query.repositoryId)}`);
        if (query.language) conditions.push(`cc.language = '${query.language.replace(/'/g, "''")}'`);
        if (query.chunkType) conditions.push(`cc.chunk_type = '${query.chunkType.replace(/'/g, "''")}'`);

        const whereClause = conditions.join(" AND ");

        const results = await db.execute(sql.raw(`
          SELECT
            cc.id,
            cc.repository_id,
            cc.file_path,
            cc.chunk_type,
            cc.symbol_name,
            cc.language,
            cc.start_line,
            cc.end_line,
            cc.content,
            cc.context_header,
            cc.commit_sha,
            r.full_name as repo_full_name,
            1 - (cc.embedding <=> '${embeddingStr}'::vector) AS similarity
          FROM code_chunks cc
          JOIN repositories r ON r.id = cc.repository_id
          WHERE ${whereClause}
          ORDER BY cc.embedding <=> '${embeddingStr}'::vector
          LIMIT ${limit}
        `));

        return {
          results: (results.rows as any[]).map((r) => ({
            id: String(r.id),
            repositoryId: String(r.repository_id),
            repoFullName: r.repo_full_name,
            filePath: r.file_path,
            chunkType: r.chunk_type,
            symbolName: r.symbol_name,
            language: r.language,
            startLine: r.start_line,
            endLine: r.end_line,
            content: r.content,
            contextHeader: r.context_header,
            commitSha: r.commit_sha,
            similarity: Number(r.similarity),
          })),
        };
      },
      {
        query: t.Object({
          tenantId: t.String(),
          queryEmbedding: t.String(),
          repositoryId: t.Optional(t.String()),
          language: t.Optional(t.String()),
          chunkType: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        }),
      }
    )
    // ── Repo index status: list all for a tenant ──
    .get(
      "/repo-index-status",
      async ({ request, query, set }) => {
        const key = request.headers.get("x-internal-key");
        if (!key || !verifyInternalKey(key)) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const tenantId = Number(query.tenantId);
        if (!tenantId) {
          set.status = 400;
          return { error: "tenantId is required" };
        }

        const rows = await db
          .select({
            id: repoIndexStatus.id,
            repositoryId: repoIndexStatus.repositoryId,
            status: repoIndexStatus.status,
            lastIndexedSha: repoIndexStatus.lastIndexedSha,
            lastIndexedAt: repoIndexStatus.lastIndexedAt,
            fileCount: repoIndexStatus.fileCount,
            chunkCount: repoIndexStatus.chunkCount,
            error: repoIndexStatus.error,
            repoFullName: repositories.fullName,
          })
          .from(repoIndexStatus)
          .innerJoin(repositories, eq(repositories.id, repoIndexStatus.repositoryId))
          .where(eq(repoIndexStatus.tenantId, tenantId));

        return {
          statuses: rows.map((r) => ({
            id: String(r.id),
            repositoryId: String(r.repositoryId),
            repoFullName: r.repoFullName,
            status: r.status,
            lastIndexedSha: r.lastIndexedSha,
            lastIndexedAt: r.lastIndexedAt?.toISOString() ?? null,
            fileCount: r.fileCount,
            chunkCount: r.chunkCount,
            error: r.error,
          })),
        };
      },
      {
        query: t.Object({ tenantId: t.String() }),
      }
    );
}
