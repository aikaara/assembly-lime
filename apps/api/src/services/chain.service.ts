import { eq } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { agentRuns } from "@assembly-lime/shared/db/schema";
import type { AgentChainConfig, AgentMode, AgentProviderId } from "@assembly-lime/shared";
import { createAgentRun } from "./agent-run.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "chain-service" });

const MAX_CHAIN_DEPTH = 10;

/**
 * Progress a chain to its next step when a run completes.
 * Called from the internal-events status handler.
 */
export async function progressChain(db: Db, runId: number): Promise<void> {
  // 1. Load the run's chain config
  const [run] = await db
    .select({
      id: agentRuns.id,
      tenantId: agentRuns.tenantId,
      projectId: agentRuns.projectId,
      ticketId: agentRuns.ticketId,
      provider: agentRuns.provider,
      inputPrompt: agentRuns.inputPrompt,
      chainConfig: agentRuns.chainConfig,
      parentRunId: agentRuns.parentRunId,
    })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId));

  if (!run?.chainConfig) return; // No chain config — nothing to do

  const chain = run.chainConfig as AgentChainConfig;
  const nextIndex = chain.currentStepIndex + 1;

  if (nextIndex >= chain.steps.length) {
    log.info({ runId, totalSteps: chain.steps.length }, "chain completed — no more steps");
    return;
  }

  // Safety: count chain depth from root to prevent infinite loops
  let depth = 0;
  let currentParentId = run.parentRunId;
  while (currentParentId && depth < MAX_CHAIN_DEPTH + 1) {
    const [parent] = await db
      .select({ parentRunId: agentRuns.parentRunId })
      .from(agentRuns)
      .where(eq(agentRuns.id, currentParentId));
    currentParentId = parent?.parentRunId ?? null;
    depth++;
  }
  if (depth >= MAX_CHAIN_DEPTH) {
    log.warn({ runId, depth }, "chain depth limit reached — stopping chain progression");
    return;
  }

  const nextStep = chain.steps[nextIndex]!;

  // Check condition
  if (nextStep.condition === "on_issues_found") {
    // For review → bugfix: check if the review found issues
    // (look for keywords in outputSummary — simple heuristic)
    const [completedRun] = await db
      .select({ outputSummary: agentRuns.outputSummary })
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));
    const summary = (completedRun?.outputSummary ?? "").toLowerCase();
    const hasIssues = summary.includes("issue") || summary.includes("bug") || summary.includes("error") || summary.includes("fix");
    if (!hasIssues) {
      log.info({ runId, nextIndex }, "chain step skipped — condition 'on_issues_found' not met");
      // Skip this step and try the next one
      const skipChainConfig: AgentChainConfig = { ...chain, currentStepIndex: nextIndex };
      // Recursively check next step (update this run's chain config to skip ahead)
      await db
        .update(agentRuns)
        .set({ chainConfig: skipChainConfig })
        .where(eq(agentRuns.id, runId));
      return progressChain(db, runId);
    }
  }

  // Build next chain config with incremented index
  const nextChainConfig: AgentChainConfig = {
    ...chain,
    currentStepIndex: nextIndex,
  };

  // Create the next run in the chain
  const rootRunId = run.parentRunId ?? run.id;
  const nextRun = await createAgentRun(db, {
    tenantId: run.tenantId,
    projectId: run.projectId,
    ticketId: run.ticketId ?? undefined,
    provider: run.provider as AgentProviderId,
    mode: nextStep.mode as AgentMode,
    prompt: run.inputPrompt,
  });

  // Link to root and set chain config
  await db
    .update(agentRuns)
    .set({
      parentRunId: rootRunId,
      chainConfig: nextChainConfig,
    })
    .where(eq(agentRuns.id, nextRun.id));

  log.info({
    runId,
    nextRunId: nextRun.id,
    nextMode: nextStep.mode,
    stepIndex: nextIndex,
    totalSteps: chain.steps.length,
    rootRunId,
  }, "chain progressed to next step");
}
