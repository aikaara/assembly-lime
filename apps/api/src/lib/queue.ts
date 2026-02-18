import { configure, tasks } from "@trigger.dev/sdk/v3";
import type { AgentJobPayload } from "@assembly-lime/shared";
import { childLogger } from "./logger";

const log = childLogger({ module: "queue" });

// Force-clear any stale Trigger.dev global config (survives Bun --watch reloads)
// then re-configure with the current env var.
const TRIGGER_GLOBAL = Symbol.for("dev.trigger.ts.api");
const g = globalThis as Record<symbol, Record<string, unknown> | undefined>;
if (g[TRIGGER_GLOBAL]) {
  delete g[TRIGGER_GLOBAL]["api-client"];
}
configure({ accessToken: process.env.TRIGGER_SECRET_KEY });

// ── Agent dispatch ──────────────────────────────────────────────────

export async function dispatchAgentRun(
  provider: "claude" | "codex",
  runId: number,
  payload: AgentJobPayload,
) {
  const taskId = provider === "claude" ? "claude-agent" : "codex-agent";
  const handle = await tasks.trigger(taskId, payload, {
    idempotencyKey: `run-${runId}`,
  });
  log.info(
    { runId, provider, triggerRunId: handle.id },
    "agent run dispatched to Trigger.dev",
  );
  return handle;
}

// ── Dependency scan dispatch ────────────────────────────────────────

export async function dispatchDepScan(tenantId: number) {
  const handle = await tasks.trigger("dep-scan", { tenantId }, {
    idempotencyKey: `dep-scan-${tenantId}-${Date.now()}`,
  });
  log.info({ tenantId, triggerRunId: handle.id }, "dep scan dispatched to Trigger.dev");
  return handle;
}

/** Logger callback that writes to both pino and job.log */
export type JobLogger = (message: string) => Promise<void>;
