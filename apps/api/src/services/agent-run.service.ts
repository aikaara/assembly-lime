import { eq } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { agentRuns } from "@assembly-lime/shared/db/schema";
import type {
  AgentProviderId,
  AgentMode,
  AgentJobPayload,
  ImageAttachment,
} from "@assembly-lime/shared";
import { resolvePrompt } from "@assembly-lime/shared/prompts";
import { resolveInstructionLayers } from "./instruction-resolver";
import { getQueueForProvider } from "../lib/bullmq";
import { logger } from "../lib/logger";

type CreateRunInput = {
  tenantId: number;
  projectId: number;
  ticketId?: number;
  provider: AgentProviderId;
  mode: AgentMode;
  prompt: string;
  repo?: {
    repositoryId: number;
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
    repo: input.repo,
    constraints: input.constraints,
    images: input.images,
  };

  // 5. Enqueue BullMQ job
  const queue = getQueueForProvider(input.provider);
  await queue.add(`run-${run.id}`, payload, {
    jobId: `run-${run.id}`,
  });

  logger.info({ runId: run.id, provider: input.provider, mode: input.mode }, "agent run enqueued");

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
