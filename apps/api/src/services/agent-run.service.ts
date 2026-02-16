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
import { getQueueForProvider } from "../lib/bullmq";
import { getClusterClient } from "./k8s-cluster.service";
import { getConnector, getConnectorToken } from "./connector.service";
import { getDecryptedEnvVars } from "./env-var.service";
import { tenantNamespace, ensureGitCredentialSecret } from "./namespace-provisioner.service";
import { launchAgentK8sJob } from "./k8s-job-launcher.service";
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

  // 4. Build job payload
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
    constraints: input.constraints,
    images: input.images,
  };

  // Enrich repo auth token for Daytona before dispatching (if needed)
  if (payload.repo && process.env.SANDBOX_PROVIDER?.toLowerCase() === "daytona") {
    try {
      if (input.repo?.connectorId) {
        const connector = await getConnector(db, input.tenantId, input.repo.connectorId);
        if (connector) {
          payload.repo.authToken = getConnectorToken(connector);
        }
      }
    } catch {}
  }

  // 5. Dispatch: Daytona (if SANDBOX_PROVIDER=daytona) → K8s → BullMQ
  const sandboxProvider = process.env.SANDBOX_PROVIDER?.toLowerCase();

  // Daytona path: always BullMQ, worker creates the sandbox
  if (sandboxProvider === "daytona" && payload.repo) {
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
      "agent run enqueued via BullMQ (Daytona)",
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
    // BullMQ path (dev mode / no K8s)
    const queue = getQueueForProvider(input.provider);
    await queue.add(`run-${run.id}`, payload, {
      jobId: `run-${run.id}`,
    });
    logger.info({ runId: run.id, provider: input.provider, mode: input.mode }, "agent run enqueued via BullMQ");
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
