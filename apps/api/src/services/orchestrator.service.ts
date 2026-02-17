import { eq, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { agentRuns } from "@assembly-lime/shared/db/schema";
import type { AgentProviderId, AgentMode, AgentJobPayload } from "@assembly-lime/shared";
import { getQueueForProvider } from "../lib/queue";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "orchestrator-service" });

type CreateParentRunInput = {
  tenantId: number;
  projectId: number;
  ticketId?: number;
  provider: AgentProviderId;
  mode: AgentMode;
  prompt: string;
  resolvedPrompt: string;
  orchestrationMode: "parallel" | "sequential";
};

export async function createParentRun(db: Db, input: CreateParentRunInput) {
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
      resolvedPrompt: input.resolvedPrompt,
      orchestrationMode: input.orchestrationMode,
    })
    .returning();

  log.info({ runId: run!.id, orchestrationMode: input.orchestrationMode }, "parent run created");
  return run!;
}

type SubTask = {
  prompt: string;
  resolvedPrompt: string;
  repo?: AgentJobPayload["repo"];
};

export async function fanOutSubRuns(
  db: Db,
  tenantId: number,
  parentRunId: number,
  provider: AgentProviderId,
  mode: AgentMode,
  projectId: number,
  subTasks: SubTask[]
) {
  const childRuns = [];
  for (const task of subTasks) {
    const [run] = await db
      .insert(agentRuns)
      .values({
        tenantId,
        projectId,
        provider,
        mode,
        status: "queued",
        inputPrompt: task.prompt,
        resolvedPrompt: task.resolvedPrompt,
        parentRunId,
      })
      .returning();

    const payload: AgentJobPayload = {
      runId: run!.id,
      tenantId,
      projectId,
      provider,
      mode,
      resolvedPrompt: task.resolvedPrompt,
      inputPrompt: task.prompt,
      repo: task.repo,
      parentRunId,
    };

    const queue = getQueueForProvider(provider);
    await queue.add(`run-${run!.id}`, payload, { jobId: `run-${run!.id}` });

    childRuns.push(run!);
  }

  log.info({ parentRunId, childCount: childRuns.length }, "sub-runs fanned out");
  return childRuns;
}

export async function checkParentCompletion(db: Db, parentRunId: number) {
  const children = await db
    .select({ status: agentRuns.status })
    .from(agentRuns)
    .where(eq(agentRuns.parentRunId, parentRunId));

  if (children.length === 0) return false;

  const allDone = children.every(
    (c) => c.status === "completed" || c.status === "failed" || c.status === "cancelled"
  );

  if (!allDone) return false;

  const anyFailed = children.some((c) => c.status === "failed");
  const finalStatus = anyFailed ? "failed" : "completed";

  await db
    .update(agentRuns)
    .set({ status: finalStatus, endedAt: new Date() })
    .where(eq(agentRuns.id, parentRunId));

  log.info({ parentRunId, finalStatus, childCount: children.length }, "parent run completed");
  return true;
}

export async function getRunHierarchy(db: Db, runId: number) {
  const [parent] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, runId));
  if (!parent) return null;

  const children = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.parentRunId, runId));

  return { parent, children };
}

export async function listChildRuns(db: Db, parentRunId: number) {
  return db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.parentRunId, parentRunId));
}
