import { eq } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { agentRuns, tenants } from "@assembly-lime/shared/db/schema";
import type {
  AgentProviderId,
  AgentMode,
  AgentJobPayload,
  ImageAttachment,
} from "@assembly-lime/shared";
import { resolvePrompt } from "@assembly-lime/shared/prompts";
import { resolveInstructionLayers } from "./instruction-resolver";
import { getQueueForProvider } from "../lib/queue";
import { getClusterClient } from "./k8s-cluster.service";
import { getConnector, getConnectorToken } from "./connector.service";
import { getDecryptedEnvVars } from "./env-var.service";
import { tenantNamespace, ensureGitCredentialSecret } from "./namespace-provisioner.service";
import { launchAgentK8sJob } from "./k8s-job-launcher.service";
import { resolveReposForRun, type RepoInfo } from "./multi-repo.service";
import { logger } from "../lib/logger";

type CreateRunInput = {
  tenantId: number;
  projectId: number;
  ticketId?: number;
  provider: AgentProviderId;
  mode: AgentMode;
  prompt: string;
  clusterId?: number;
  repo?: {
    repositoryId: number;
    connectorId?: number;
    owner?: string;
    name?: string;
    cloneUrl: string;
    defaultBranch: string;
    ref?: string;
    allowedPaths?: string[];
  };
  constraints?: {
    timeBudgetSec?: number;
    maxCostCents?: number;
    allowedTools?: string[];
  };
  envVarSetId?: number;
  images?: ImageAttachment[];
};

export async function createAgentRun(db: Db, input: CreateRunInput) {
  // 1. Resolve instruction layers from DB
  const instructionLayers = await resolveInstructionLayers(db, {
    tenantId: input.tenantId,
    provider: input.provider,
    mode: input.mode,
    projectId: input.projectId,
    repositoryId: input.repo?.repositoryId,
    ticketId: input.ticketId,
  });

  // 2. Build resolved prompt
  const resolved = resolvePrompt({
    provider: input.provider,
    mode: input.mode,
    instructionLayers,
    userPrompt: input.prompt,
  });

  // 3. Insert agent_runs row
  const [run] = await db
    .insert(agentRuns)
    .values({
      tenantId: input.tenantId,
      projectId: input.projectId,
      ticketId: input.ticketId,
      provider: input.provider,
      mode: input.mode,
      status: "queued",
      inputPrompt: input.prompt,
      resolvedPrompt: resolved,
    })
    .returning();

  if (!run) throw new Error("Failed to create agent run");

  // 4. Auto-resolve repos when not provided (Daytona sandbox mode)
  const sandboxProvider = process.env.SANDBOX_PROVIDER?.toLowerCase();
  let resolvedRepos: RepoInfo[] | undefined;

  if (!input.repo && sandboxProvider === "daytona") {
    resolvedRepos = await resolveReposForRun(db, input.tenantId, input.projectId);
    if (resolvedRepos.length === 0) {
      throw new Error("No repositories linked to this project — cannot run agent without a sandbox");
    }
    if (resolvedRepos.length === 1) {
      // Single repo — promote to input.repo for standard single-repo path
      const r = resolvedRepos[0]!;
      input.repo = {
        repositoryId: r.repositoryId,
        connectorId: r.connectorId,
        owner: r.owner,
        name: r.name,
        cloneUrl: r.cloneUrl,
        defaultBranch: r.defaultBranch,
      };
      logger.info(
        { runId: run.id, repoId: r.repositoryId, repoName: `${r.owner}/${r.name}` },
        "auto-resolved single repo for run",
      );
    } else {
      logger.info(
        { runId: run.id, repoCount: resolvedRepos.length },
        "auto-resolved multiple repos for run",
      );
    }
  }

  // 5. Build job payload
  const payload: AgentJobPayload = {
    runId: run.id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    ticketId: input.ticketId,
    provider: input.provider,
    mode: input.mode,
    resolvedPrompt: resolved,
    inputPrompt: input.prompt,
    repo: input.repo
      ? {
          repositoryId: input.repo.repositoryId,
          connectorId: input.repo.connectorId ?? 0,
          owner: input.repo.owner ?? "",
          name: input.repo.name ?? "",
          cloneUrl: input.repo.cloneUrl,
          defaultBranch: input.repo.defaultBranch,
          ref: input.repo.ref,
          allowedPaths: input.repo.allowedPaths,
        }
      : undefined,
    // Multi-repo: only set when multiple repos were auto-resolved
    repos: resolvedRepos && resolvedRepos.length > 1
      ? resolvedRepos.map((r) => ({
          repositoryId: r.repositoryId,
          cloneUrl: r.cloneUrl,
          defaultBranch: r.defaultBranch,
        }))
      : undefined,
    constraints: input.constraints,
    images: input.images,
  };

  // Enrich repo auth token for Daytona before dispatching (if needed)
  if (payload.repo && sandboxProvider === "daytona") {
    try {
      const connId = input.repo?.connectorId ?? payload.repo.connectorId;
      if (connId) {
        const connector = await getConnector(db, input.tenantId, connId);
        if (connector) {
          payload.repo.authToken = getConnectorToken(connector);
        }
      }
    } catch {}
  }

  // 6. Dispatch: Daytona (if SANDBOX_PROVIDER=daytona) → K8s → bunqueue
  // Daytona path: always bunqueue, worker creates the sandbox
  if (sandboxProvider === "daytona" && (payload.repo || (payload.repos && payload.repos.length > 0))) {
    payload.sandbox = { provider: "daytona" };
    // Decrypt env vars if an env var set is specified
    if (input.envVarSetId) {
      try {
        const decrypted = await getDecryptedEnvVars(db, input.tenantId, input.envVarSetId);
        // Filter out empty placeholder values
        const filtered: Record<string, string> = {};
        for (const [k, v] of Object.entries(decrypted)) {
          if (v) filtered[k] = v;
        }
        if (Object.keys(filtered).length > 0) {
          payload.sandbox.envVars = filtered;
        }
      } catch (e) {
        logger.warn({ err: e, envVarSetId: input.envVarSetId }, "failed to decrypt env vars for Daytona run");
      }
    }
    const queue = getQueueForProvider(input.provider);
    await queue.add(`run-${run.id}`, payload, { jobId: `run-${run.id}` });
    logger.info(
      { runId: run.id, provider: input.provider, mode: input.mode, sandbox: "daytona" },
      "agent run enqueued (Daytona)",
    );
    return run;
  }

  // K8s path
  if (input.clusterId && input.repo?.connectorId && input.repo?.owner && input.repo?.name) {
    // K8s path: decrypt connector token, ensure git credential secret, launch Job
    const [tenant] = await db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId));
    if (!tenant) throw new Error("Tenant not found");

    const connector = await getConnector(db, input.tenantId, input.repo.connectorId);
    if (!connector) throw new Error("Connector not found");

    const token = getConnectorToken(connector);
    const ns = tenantNamespace(tenant.slug);
    const secretName = `git-cred-${input.repo.connectorId}`;

    const kc = await getClusterClient(db, input.tenantId, input.clusterId);
    await ensureGitCredentialSecret(kc, ns, secretName, token);

    payload.k8s = {
      clusterId: input.clusterId,
      namespace: ns,
      gitCredentialSecretName: secretName,
    };

    await launchAgentK8sJob(db, input.tenantId, input.clusterId, payload);
    logger.info(
      { runId: run.id, provider: input.provider, mode: input.mode, clusterId: input.clusterId },
      "agent run dispatched to K8s"
    );
  } else {
    // bunqueue path (dev mode / no K8s)
    const queue = getQueueForProvider(input.provider);
    await queue.add(`run-${run.id}`, payload, {
      jobId: `run-${run.id}`,
    });
    logger.info({ runId: run.id, provider: input.provider, mode: input.mode }, "agent run enqueued");
  }

  return run;
}

export async function getAgentRun(db: Db, runId: number) {
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, runId));
  return run ?? null;
}

export async function updateAgentRunStatus(
  db: Db,
  runId: number,
  status: string,
  extra?: { outputSummary?: string; endedAt?: Date; startedAt?: Date }
) {
  await db
    .update(agentRuns)
    .set({ status, ...extra })
    .where(eq(agentRuns.id, runId));
}
