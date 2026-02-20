import { Elysia, t } from "elysia";
import { eq, asc, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { agentEvents, agentRuns, agentRunRepos, repositories, tickets } from "@assembly-lime/shared/db/schema";
import { requireAuth } from "../middleware/auth";
import { createAgentRun, getAgentRun } from "../services/agent-run.service";
import { resumeAgentRun } from "../services/agent-resume.service";
import { getConnector, getConnectorToken } from "../services/connector.service";
import { broadcastToWs } from "./ws";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "agent-run-routes" });
export function agentRunRoutes(db: Db) {
  return new Elysia({ prefix: "/agent-runs" })
    .use(requireAuth)

    // ── Create run ──
    .post(
      "/",
      async ({ auth, body }) => {
        log.info({ tenantId: auth!.tenantId, provider: body.provider, mode: body.mode, projectId: body.projectId }, "creating agent run");

        // Resolve repo from repositoryId shorthand if full repo object not provided
        let repo = body.repo;
        if (!repo && body.repositoryId) {
          const [row] = await db
            .select()
            .from(repositories)
            .where(
              and(
                eq(repositories.id, body.repositoryId),
                eq(repositories.tenantId, auth!.tenantId)
              )
            );
          if (!row) throw new Error("Repository not found");
          repo = {
            repositoryId: row.id,
            connectorId: row.connectorId,
            owner: row.owner,
            name: row.name,
            cloneUrl: row.cloneUrl,
            defaultBranch: row.defaultBranch,
          };
        }

        const run = await createAgentRun(db, {
          tenantId: auth!.tenantId,
          projectId: body.projectId,
          ticketId: body.ticketId,
          provider: body.provider,
          mode: body.mode,
          prompt: body.prompt,
          clusterId: body.clusterId,
          repo,
          constraints: body.constraints,
        });
        log.info({ runId: run.id, provider: body.provider, mode: body.mode }, "agent run created");
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
          clusterId: t.Optional(t.Number()),
          repositoryId: t.Optional(t.Number()),
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
              connectorId: t.Optional(t.Number()),
              owner: t.Optional(t.String()),
              name: t.Optional(t.String()),
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

    // ── Send message to a run (follow-up / chat continuation) ──
    .post(
      "/:id/message",
      async ({ auth, params, body, set }) => {
        const runId = Number(params.id);
        if (isNaN(runId)) {
          set.status = 400;
          return { error: "invalid run id" };
        }

        const run = await getAgentRun(db, runId);
        if (!run || run.tenantId !== auth!.tenantId) {
          set.status = 404;
          return { error: "run not found" };
        }

        const rejectedStatuses = ["failed", "cancelled"];
        if (rejectedStatuses.includes(run.status)) {
          set.status = 409;
          return { error: `run status is "${run.status}", cannot send messages` };
        }

        const event = {
          type: "user_message" as const,
          text: body.text,
        };

        await db.insert(agentEvents).values({
          tenantId: auth!.tenantId,
          agentRunId: runId,
          type: "user_message",
          payloadJson: event,
        });

        broadcastToWs(runId, event);
        log.info({ runId, textLength: body.text.length }, "user message sent to agent run");

        // If the worker has exited (terminal/waiting status), re-dispatch to continue
        const workerExitedStatuses = ["completed", "awaiting_approval"];
        if (workerExitedStatuses.includes(run.status)) {
          log.info({ runId, previousStatus: run.status }, "worker exited — dispatching continuation");
          try {
            await resumeAgentRun(db, run as Parameters<typeof resumeAgentRun>[1]);
          } catch (err) {
            log.error({ err, runId }, "failed to dispatch agent continuation");
            // Don't fail the request — message is stored, user can retry
          }
        }

        return { ok: true };
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({ text: t.String({ minLength: 1 }) }),
      }
    )

    // ── Reject a run ──
    .post(
      "/:id/reject",
      async ({ auth, params, set }) => {
        const runId = Number(params.id);
        if (isNaN(runId)) {
          set.status = 400;
          return { error: "invalid run id" };
        }

        const run = await getAgentRun(db, runId);
        if (!run || run.tenantId !== auth!.tenantId) {
          set.status = 404;
          return { error: "run not found" };
        }

        if (run.status !== "awaiting_approval") {
          set.status = 409;
          return { error: `run status is "${run.status}", expected "awaiting_approval"` };
        }

        await db
          .update(agentRuns)
          .set({ status: "cancelled", endedAt: new Date(), outputSummary: "Rejected by user" })
          .where(eq(agentRuns.id, runId));

        const statusEvent = {
          type: "status" as const,
          status: "cancelled" as const,
          message: "Run rejected by user.",
        };
        await db.insert(agentEvents).values({
          tenantId: auth!.tenantId,
          agentRunId: runId,
          type: "status",
          payloadJson: statusEvent,
        });
        broadcastToWs(runId, statusEvent);

        log.info({ runId }, "agent run rejected by user");
        return { ok: true };
      },
      { params: t.Object({ id: t.String() }) }
    )

    // ── Approve a run ──
    .post(
      "/:id/approve",
      async ({ auth, params, set }) => {
        const runId = Number(params.id);
        if (isNaN(runId)) {
          set.status = 400;
          return { error: "invalid run id" };
        }

        // 1. Load run and verify ownership + status
        const run = await getAgentRun(db, runId);
        if (!run || run.tenantId !== auth!.tenantId) {
          set.status = 404;
          return { error: "run not found" };
        }
        if (run.status !== "awaiting_approval") {
          set.status = 409;
          return { error: `run status is "${run.status}", expected "awaiting_approval"` };
        }

        // ── Plan mode: approve → spawn implement runs for child tasks ──
        if (run.mode === "plan") {
          return approvePlanRun(db, auth!.tenantId, run, runId);
        }

        // ── Implement/bugfix mode: approve → create PR ──
        return approveCodeRun(db, auth!.tenantId, run, runId);
      },
      { params: t.Object({ id: t.String() }) }
    )

    // ── Get run events ──
    .get(
      "/:id/events",
      async ({ params }) => {
        const runId = Number(params.id);
        if (isNaN(runId)) return [];
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
    )

    // ── Get run detail ──
    .get(
      "/:id",
      async ({ params }) => {
        const runId = Number(params.id);
        if (isNaN(runId)) return { error: "not found" };
        const run = await getAgentRun(db, runId);
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
          parentRunId: run.parentRunId ? String(run.parentRunId) : null,
          createdAt: run.createdAt.toISOString(),
          startedAt: run.startedAt?.toISOString() ?? null,
          endedAt: run.endedAt?.toISOString() ?? null,
        };
      },
      { params: t.Object({ id: t.String() }) }
    );
}

// ── Plan approve: load child tickets, spawn implement runs ──────────
async function approvePlanRun(
  db: Db,
  tenantId: number,
  run: NonNullable<Awaited<ReturnType<typeof getAgentRun>>>,
  runId: number,
) {
  // Load child tickets created by this plan run
  const childTickets = await db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.tenantId, tenantId),
        eq(tickets.agentRunId, runId),
      )
    );

  if (childTickets.length === 0) {
    // No tasks were created — just mark completed
    await db
      .update(agentRuns)
      .set({ status: "completed", endedAt: new Date(), outputSummary: "Plan approved (no tasks to implement)" })
      .where(eq(agentRuns.id, runId));

    const statusEvent = {
      type: "status" as const,
      status: "completed" as const,
      message: "Plan approved — no implementation tasks were created.",
    };
    await db.insert(agentEvents).values({
      tenantId,
      agentRunId: runId,
      type: "status",
      payloadJson: statusEvent,
    });
    broadcastToWs(runId, statusEvent);

    return { ok: true, childRuns: [] };
  }

  // Spawn an implement run for each child ticket
  const childRunIds: number[] = [];
  for (const ticket of childTickets) {
    const childRun = await createAgentRun(db, {
      tenantId,
      projectId: run.projectId,
      ticketId: ticket.id,
      provider: run.provider as "claude" | "codex",
      mode: "implement",
      prompt: `${ticket.title}\n\n${ticket.descriptionMd ?? ""}`.trim(),
    });
    // Link child run back to plan run
    await db
      .update(agentRuns)
      .set({ parentRunId: runId })
      .where(eq(agentRuns.id, childRun.id));

    childRunIds.push(childRun.id);
  }

  log.info({ runId, childRunCount: childRunIds.length }, "plan approved — implement runs spawned");

  // Mark plan run as plan_approved → completed
  await db
    .update(agentRuns)
    .set({
      status: "completed",
      endedAt: new Date(),
      outputSummary: `Plan approved — ${childRunIds.length} implement run(s) dispatched.`,
    })
    .where(eq(agentRuns.id, runId));

  const statusEvent = {
    type: "status" as const,
    status: "completed" as const,
    message: `Plan approved — ${childRunIds.length} implement run(s) dispatched.`,
  };
  await db.insert(agentEvents).values({
    tenantId,
    agentRunId: runId,
    type: "status",
    payloadJson: statusEvent,
  });
  broadcastToWs(runId, statusEvent);

  // Emit artifact linking to child runs
  const artifactEvent = {
    type: "artifact" as const,
    name: "child_runs",
    url: childRunIds.map(String).join(","),
    mime: "text/plain",
  };
  await db.insert(agentEvents).values({
    tenantId,
    agentRunId: runId,
    type: "artifact",
    payloadJson: artifactEvent,
  });
  broadcastToWs(runId, artifactEvent);

  return { ok: true, childRuns: childRunIds.map(String) };
}

// ── Code approve: create PR from branch ─────────────────────────────
async function approveCodeRun(
  db: Db,
  tenantId: number,
  run: NonNullable<Awaited<ReturnType<typeof getAgentRun>>>,
  runId: number,
) {
  // 2. Load repo info from agent_run_repos to get branch name
  const [runRepo] = await db
    .select()
    .from(agentRunRepos)
    .where(eq(agentRunRepos.agentRunId, runId));
  if (!runRepo) {
    return { error: "no repository associated with this run" };
  }

  // 3. Load repository to get owner/name/defaultBranch/connectorId
  const [repo] = await db
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.id, runRepo.repositoryId),
        eq(repositories.tenantId, tenantId),
      )
    );
  if (!repo) {
    return { error: "repository not found" };
  }

  // 4. Get auth token from connector
  const connector = await getConnector(db, tenantId, repo.connectorId);
  if (!connector) {
    return { error: "connector not found" };
  }
  const authToken = getConnectorToken(connector);

  // 5. Create PR via GitHub API
  const branchName = runRepo.branch;
  const prRes = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.name}/pulls`,
    {
      method: "POST",
      headers: {
        authorization: `token ${authToken}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: `[${run.mode}] Agent run #${runId}`,
        head: branchName,
        base: repo.defaultBranch,
        body: `Auto-generated by AssemblyLime agent run #${runId} (mode: ${run.mode}).`,
      }),
    },
  );

  if (!prRes.ok) {
    const errBody = await prRes.text();
    log.warn({ status: prRes.status, body: errBody, runId }, "PR creation failed on approve");
    return { error: "failed to create PR", detail: errBody };
  }

  const pr = (await prRes.json()) as { html_url: string; number: number };
  log.info({ runId, prUrl: pr.html_url, prNumber: pr.number }, "PR created via approve");

  // 6. Emit pull_request artifact event + persist
  const artifactEvent = {
    type: "artifact" as const,
    name: "pull_request",
    url: pr.html_url,
    mime: "text/html",
  };
  await db.insert(agentEvents).values({
    tenantId,
    agentRunId: runId,
    type: "artifact",
    payloadJson: artifactEvent,
  });
  broadcastToWs(runId, artifactEvent);

  // 7. Update run status to completed
  const statusEvent = {
    type: "status" as const,
    status: "completed" as const,
    message: `PR created: ${pr.html_url}`,
  };
  await db.insert(agentEvents).values({
    tenantId,
    agentRunId: runId,
    type: "status",
    payloadJson: statusEvent,
  });
  await db
    .update(agentRuns)
    .set({ status: "completed", endedAt: new Date(), outputSummary: `PR created: ${pr.html_url}` })
    .where(eq(agentRuns.id, runId));
  broadcastToWs(runId, statusEvent);

  return { ok: true, prUrl: pr.html_url, prNumber: pr.number };
}
