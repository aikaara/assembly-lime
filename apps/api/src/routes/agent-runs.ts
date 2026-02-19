import { Elysia, t } from "elysia";
import { eq, asc, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { agentEvents, agentRuns, agentRunRepos, repositories } from "@assembly-lime/shared/db/schema";
import { requireAuth } from "../middleware/auth";
import { createAgentRun, getAgentRun } from "../services/agent-run.service";
import { getConnector, getConnectorToken } from "../services/connector.service";
import { broadcastToWs } from "./ws";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "agent-run-routes" });
export function agentRunRoutes(db: Db) {
  return new Elysia({ prefix: "/agent-runs" })
    .use(requireAuth)
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

        // 2. Load repo info from agent_run_repos to get branch name
        const [runRepo] = await db
          .select()
          .from(agentRunRepos)
          .where(eq(agentRunRepos.agentRunId, runId));
        if (!runRepo) {
          set.status = 400;
          return { error: "no repository associated with this run" };
        }

        // 3. Load repository to get owner/name/defaultBranch/connectorId
        const [repo] = await db
          .select()
          .from(repositories)
          .where(
            and(
              eq(repositories.id, runRepo.repositoryId),
              eq(repositories.tenantId, auth!.tenantId),
            )
          );
        if (!repo) {
          set.status = 400;
          return { error: "repository not found" };
        }

        // 4. Get auth token from connector
        const connector = await getConnector(db, auth!.tenantId, repo.connectorId);
        if (!connector) {
          set.status = 400;
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
          set.status = 502;
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
          tenantId: auth!.tenantId,
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
          tenantId: auth!.tenantId,
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
      },
      { params: t.Object({ id: t.String() }) }
    );
}
