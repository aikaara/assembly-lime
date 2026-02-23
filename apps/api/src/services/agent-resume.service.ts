import { eq } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { agentRuns, agentRunRepos, repositories } from "@assembly-lime/shared/db/schema";
import type { AgentJobPayload, AgentProviderId, AgentMode } from "@assembly-lime/shared";
import { dispatchAgentContinuation } from "../lib/queue";
import { getConnector, getConnectorToken } from "./connector.service";
import { resolveReposForRun, repoRoleLabel } from "./multi-repo.service";
import { logger } from "../lib/logger";

/**
 * Resume an agent run by rebuilding the payload from DB and dispatching
 * a continuation task via Trigger.dev. The worker will restore the
 * conversation from sessionMessagesJson and pick up the new user message.
 */
export async function resumeAgentRun(
  db: Db,
  run: {
    id: number;
    tenantId: number;
    projectId: number;
    ticketId: number | null;
    provider: string;
    mode: string;
    resolvedPrompt: string | null;
    inputPrompt: string;
  },
) {
  const runId = run.id;

  // 1. Update status to queued so the worker knows this is a continuation
  await db
    .update(agentRuns)
    .set({ status: "queued", endedAt: null })
    .where(eq(agentRuns.id, runId));

  // 2. Load repo info from agent_run_repos + repositories
  const runRepos = await db
    .select({
      repositoryId: agentRunRepos.repositoryId,
      branch: agentRunRepos.branch,
      connectorId: repositories.connectorId,
      owner: repositories.owner,
      name: repositories.name,
      cloneUrl: repositories.cloneUrl,
      defaultBranch: repositories.defaultBranch,
    })
    .from(agentRunRepos)
    .innerJoin(repositories, eq(agentRunRepos.repositoryId, repositories.id))
    .where(eq(agentRunRepos.agentRunId, runId));

  // 3. Build payload
  const payload: AgentJobPayload = {
    runId,
    tenantId: run.tenantId,
    projectId: run.projectId,
    ticketId: run.ticketId ?? undefined,
    provider: run.provider as AgentProviderId,
    mode: run.mode as AgentMode,
    resolvedPrompt: run.resolvedPrompt ?? run.inputPrompt,
    inputPrompt: run.inputPrompt,
    sandbox: { provider: "daytona" },
  };

  // Mark as continuation — worker will skip initial prompt and go to follow-up loop
  payload.isContinuation = true;

  // Attach repo from run history, or fall back to project repos.
  // Use defaultBranch (NOT the working branch) since working branch may only
  // exist in the previous sandbox and was never pushed to remote (e.g., plan mode).
  if (runRepos.length > 0) {
    const r = runRepos[0]!;
    payload.repo = {
      repositoryId: r.repositoryId,
      connectorId: r.connectorId,
      owner: r.owner,
      name: r.name,
      cloneUrl: r.cloneUrl,
      defaultBranch: r.defaultBranch,
    };

    // Enrich auth token
    try {
      if (r.connectorId) {
        const connector = await getConnector(db, run.tenantId, r.connectorId);
        if (connector) {
          payload.repo.authToken = getConnectorToken(connector);
        }
      }
    } catch (err) {
      logger.warn({ err, runId }, "failed to enrich repo auth token for continuation");
    }
  } else {
    // No agent_run_repos entries — resolve from project (same as initial createAgentRun)
    logger.info({ runId }, "no agent_run_repos — resolving repos from project");
    const resolvedRepos = await resolveReposForRun(db, run.tenantId, run.projectId);

    if (resolvedRepos.length === 1) {
      const r = resolvedRepos[0]!;
      payload.repo = {
        repositoryId: r.repositoryId,
        connectorId: r.connectorId,
        owner: r.owner,
        name: r.name,
        cloneUrl: r.cloneUrl,
        defaultBranch: r.defaultBranch,
      };
      // Enrich auth token
      try {
        if (r.connectorId) {
          const connector = await getConnector(db, run.tenantId, r.connectorId);
          if (connector) {
            payload.repo.authToken = getConnectorToken(connector);
          }
        }
      } catch (err) {
        logger.warn({ err, runId }, "failed to enrich repo auth token for continuation");
      }
    } else if (resolvedRepos.length > 1) {
      // Multiple repos — let the worker LLM-select
      const tokenCache = new Map<number, string>();
      payload.repos = resolvedRepos.map((r) => ({
        repositoryId: r.repositoryId,
        connectorId: r.connectorId,
        owner: r.owner,
        name: r.name,
        fullName: r.fullName,
        cloneUrl: r.cloneUrl,
        defaultBranch: r.defaultBranch,
        roleLabel: repoRoleLabel(r.repoRole),
        notes: r.notes ?? undefined,
        isPrimary: r.isPrimary ?? undefined,
      }));
      // Enrich auth tokens
      for (const r of payload.repos) {
        if (!r.connectorId) continue;
        if (!tokenCache.has(r.connectorId)) {
          try {
            const connector = await getConnector(db, run.tenantId, r.connectorId);
            if (connector) tokenCache.set(r.connectorId, getConnectorToken(connector));
          } catch (err) {
            logger.warn({ err, runId, connectorId: r.connectorId }, "failed to enrich multi-repo auth token");
          }
        }
        const token = tokenCache.get(r.connectorId);
        if (token) r.authToken = token;
      }
    } else {
      logger.warn({ runId }, "no repos found for project — continuation will likely fail");
    }
  }

  // 4. Dispatch
  await dispatchAgentContinuation(runId, payload);
  logger.info({ runId, provider: run.provider, mode: run.mode }, "agent continuation dispatched");
}
