# Long-Running Autonomous Agent Loop

## Context

The agent loop needs to support long autonomous runs (30+ min), survive across human approval gates without burning compute, chain modes (plan -> implement -> review -> fix), and manage Daytona sandbox resources efficiently within a 10-concurrent-sandbox limit.

**Key discoveries from research:**
- Trigger.dev v3 has **no platform duration limit** — our `maxDuration: 3600` is self-imposed
- `wait.forToken()` **checkpoints** the task via CRIU (zero compute during waits) — ideal for approval gates
- `maxDuration` only counts **CPU time**, not wait time
- Daytona SDK supports **volumes** (persistent storage), **snapshots** (pre-built images), **stop/start** (free CPU/memory, keep disk), and **`daytona.get(id)`** for reconnection
- Our Tier 1 limit is 10 vCPU — ~10 concurrent *running* sandboxes. Stopped sandboxes free CPU/memory.

## Phase 1: Trigger.dev Native Long Runs + Approval Checkpointing

### 1.1 Increase maxDuration

**Files:**
- `trigger.config.ts` — change global `maxDuration: 3600` to `14400` (4 hours)
- `apps/trigger/agent-task.ts` — change task-level `maxDuration: 3600` to `14400`
- `apps/trigger/claude-agent.ts` — same change

### 1.2 Replace HTTP-callback approval with `wait.forToken()`

Currently, when a run reaches `awaiting_approval`, the worker exits and the Trigger.dev task ends. If the user approves, the API dispatches a brand-new Trigger.dev task via `resumeAgentRun()` that creates a fresh sandbox, re-clones the repo, and restores the session. This is slow and wasteful.

With `wait.forToken()`, the task **pauses in place** (CRIU checkpoint, zero compute) while keeping the sandbox alive. When the user approves, the task resumes instantly in the same sandbox — no re-clone, no session restore needed.

**File: `apps/trigger/agent-task.ts`**

Restructure the task to use `wait.forToken()`:

```typescript
import { task, wait } from "@trigger.dev/sdk/v3";

export const agentTask = task({
  id: "agent-task",
  maxDuration: 14400,
  retry: { maxAttempts: 1 },
  run: async (payload: AgentJobPayload) => {
    const result = await runUnifiedAgent(payload);

    // If agent wants approval, create a wait token
    if (result.needsApproval) {
      const token = await wait.createToken({
        timeout: "24h",
        idempotencyKey: `approval-${payload.runId}`,
        tags: [`run-${payload.runId}`],
      });

      // Store token ID so API can complete it on user approve
      await storeApprovalToken(payload.runId, token.id);

      // Task checkpoints here — zero compute cost
      const approval = await wait.forToken<{ approved: boolean; action?: string }>(token.id);

      if (approval.ok && approval.output.approved) {
        await handleApproval(payload, result);
      }
    }
  },
});
```

**File: `apps/worker-agent/src/run.ts`**

Change `runUnifiedAgent()` to return a result object instead of emitting terminal status:

```typescript
type RunResult = {
  needsApproval: boolean;
  workspace: DaytonaWorkspace;
  agent: Agent;
  // ... context needed for post-approval work
};
```

The function no longer exits on `awaiting_approval` — it returns the result and the Trigger.dev task handles the approval wait.

**File: `apps/api/src/routes/agent-runs.ts`**

Change `approvePlanRun()` and `approveCodeRun()` to complete the wait token instead of dispatching a new Trigger.dev task:

```typescript
// On user approve:
await wait.completeToken(storedTokenId, { approved: true, action: "create_pr" });

// On user reject:
await wait.completeToken(storedTokenId, { approved: false });
```

### 1.3 Schema: Add approval token tracking

**File: `packages/shared/src/db/schema/agents.ts`**

Add columns to `agentRuns`:
```
sandboxId          text     — Daytona sandbox ID for lifecycle management
approvalTokenId    text     — Trigger.dev wait token ID for approval flow
```

### 1.4 Monitor compute usage within the run

**File: `apps/worker-agent/src/run.ts`**

Use `usage.getCurrent()` from `@trigger.dev/sdk/v3` to track CPU time and warn/steer the agent when approaching the budget:

```typescript
import { usage } from "@trigger.dev/sdk/v3";

// In the follow-up loop:
const current = usage.getCurrent();
const elapsedSec = current.attempt.durationMs / 1000;
if (elapsedSec > timeBudgetSec * 0.9) {
  agent.steer("You are approaching the time budget. Wrap up current work.");
}
```

## Phase 2: Daytona Sandbox Lifecycle Management

### 2.1 Sandbox stop/start for resource management

With a 10-sandbox limit, we need to stop idle sandboxes to free slots. Daytona's `sandbox.stop()` frees CPU/memory but keeps disk (including cloned repos).

**File: `packages/shared/src/daytona-workspace.ts`**

Add lifecycle methods:

```typescript
/** Stop sandbox to free CPU/memory (keeps disk). */
async stop(): Promise<void> {
  await this.sandbox.stop();
}

/** Start a stopped sandbox. */
async start(timeout?: number): Promise<void> {
  await this.sandbox.start(timeout);
}

/** Prevent auto-stop during active work. */
async keepAlive(): Promise<void> {
  await this.sandbox.refreshActivity();
}

/** Reconnect to existing sandbox by ID. */
static async reconnect(opts: {
  sandboxId: string;
  repoDir: string;
  authToken?: string;
}): Promise<DaytonaWorkspace> {
  const daytona = new Daytona();
  const sandbox = await daytona.get(opts.sandboxId);

  // Start if stopped
  if (sandbox.state === "stopped") {
    await sandbox.start();
  }

  const authUser = opts.authToken ? "x-access-token" : undefined;
  const authPass = opts.authToken || undefined;
  return new DaytonaWorkspace(sandbox, opts.repoDir, authUser, authPass);
}
```

**File: `apps/worker-agent/src/run.ts`**

After the approval wait resolves, the sandbox is still alive (or stopped by auto-stop). Reconnect:

```typescript
// After wait.forToken() resolves:
if (workspace.sandbox.state === "stopped") {
  await workspace.start();
}
await workspace.keepAlive(); // Reset auto-stop timer
```

### 2.2 Volumes for persistent repo storage

Use Daytona volumes to persist cloned repos across sandbox stop/start cycles and share package caches.

**File: `packages/shared/src/daytona-workspace.ts`**

Update `createSandbox()` to optionally mount a volume:

```typescript
static async createSandbox(opts: {
  runId: number;
  provider: string;
  mode: string;
  repoName: string;
  volumeName?: string; // Optional volume for repo persistence
}): Promise<DaytonaWorkspace> {
  const daytona = new Daytona();

  let volumes: Array<{ volumeId: string; mountPath: string }> | undefined;
  if (opts.volumeName) {
    const volume = await daytona.volume.get(opts.volumeName, true); // auto-create
    volumes = [{ volumeId: volume.id, mountPath: "/data" }];
  }

  const sandbox = await daytona.create({
    labels: { ... },
    autoStopInterval: 60,
    volumes,
  });
  ...
}
```

### 2.3 Native env var injection

**File: `packages/shared/src/daytona-workspace.ts`**

Pass env vars at sandbox creation time (more secure than writing .env files):

```typescript
const sandbox = await daytona.create({
  labels: { ... },
  autoStopInterval: 60,
  envVars: opts.envVars, // Native SDK support
  volumes,
});
```

Keep `injectEnvVars()` as fallback for apps that specifically read `.env` files.

### 2.4 Sandbox ID tracking

**File: `apps/worker-agent/src/run.ts`**

After sandbox creation, persist the sandbox ID to the run record for reconnection:

```typescript
// After creating sandbox
await emitter.emitSandboxInfo(workspace.sandbox.id, workspace.repoDir);
```

**File: `apps/worker-agent/src/agent/emitter.ts`**

Add `emitSandboxInfo()` method that POSTs to a new internal endpoint.

**File: `apps/api/src/routes/internal-events.ts`**

Add `POST /internal/agent-sandbox-info/:runId` that updates `agent_runs.sandboxId`.

## Phase 3: Agent Chains / Pipelines

### 3.1 Chain types

**File: `packages/shared/src/protocol.ts`**

```typescript
export type AgentChainStep = {
  mode: AgentMode;
  autoApprove: boolean;
  condition?: "always" | "on_success" | "on_issues_found";
};

export type AgentChainConfig = {
  steps: AgentChainStep[];
  currentStepIndex: number;
};

export const DEFAULT_CHAINS: Record<string, AgentChainConfig> = {
  "full-pipeline": {
    steps: [
      { mode: "plan", autoApprove: false },
      { mode: "implement", autoApprove: true },
      { mode: "review", autoApprove: true, condition: "always" },
      { mode: "bugfix", autoApprove: true, condition: "on_issues_found" },
    ],
    currentStepIndex: 0,
  },
  "implement-and-review": {
    steps: [
      { mode: "implement", autoApprove: true },
      { mode: "review", autoApprove: true, condition: "always" },
    ],
    currentStepIndex: 0,
  },
};
```

### 3.2 Chain service

**New file: `apps/api/src/services/chain.service.ts`**

`progressChain(db, runId)` — called when a run reaches `completed`:
1. Load run's `chainConfig` from DB
2. If `currentStepIndex + 1 < steps.length`, check condition and create next run
3. Carry `chainConfig` forward with incremented index
4. Link via `parentRunId` to root of chain
5. Safety: `maxChainDepth` of 10 total runs from one root

### 3.3 Hook into status events

**File: `apps/api/src/routes/internal-events.ts`** (line 62-82)

After updating run status:
- On `completed`: call `progressChain(db, runId)` (fire-and-forget with error logging)
- On `awaiting_approval` + `autoApprove: true`: auto-complete the wait token after 3s delay

### 3.4 API — accept chain config

**File: `apps/api/src/routes/agent-runs.ts`**

Add columns to `agentRuns`:
```
chainConfig  jsonb   — Pipeline definition
```

Accept optional `chainId` (string) or `chainConfig` (object) on `POST /agent-runs`. Resolve from `DEFAULT_CHAINS` and store on the run.

## Phase 4: Interactive Sessions

### 4.1 Mid-prompt steering

**File: `apps/worker-agent/src/run.ts`**

During `agent.prompt()`, start a background poller (2s interval) that checks for new user messages via `emitter.pollUserMessages()`. When found, inject via `agent.steer(messageText)`. The pi-agent's `steer()` queues the message for delivery between tool calls.

Clean up the poller after `agent.waitForIdle()`.

### 4.2 Reduce poll interval

**File: `apps/worker-agent/src/run.ts`**

Reduce follow-up poll interval from 3s to 1s for better responsiveness.

### 4.3 Periodic session checkpoints

**File: `apps/worker-agent/src/agent/event-bridge.ts`**

Add `onCheckpoint` callback to `BridgeEventsOpts`, fired every 10 turns on `turn_end`. Wire in `run.ts` to call `emitter.emitSessionSnapshot(agent.state.messages)`.

### 4.4 Transient error retry

**File: `apps/worker-agent/src/run.ts`**

Wrap `agent.prompt()` and `agent.followUp()` with a retry helper:
- Catches rate-limit (429), overloaded (529), timeout (503) errors
- Exponential backoff: 2s, 4s, 8s (max 3 retries)

## Files Summary

| File | Change |
|------|--------|
| `trigger.config.ts` | Increase `maxDuration` to 14400 |
| `apps/trigger/agent-task.ts` | `wait.forToken()` for approval, increase `maxDuration` |
| `apps/trigger/claude-agent.ts` | Increase `maxDuration` |
| `packages/shared/src/db/schema/agents.ts` | Add `sandboxId`, `approvalTokenId`, `chainConfig` columns |
| `packages/shared/src/daytona-workspace.ts` | Add `reconnect()`, `stop()`, `start()`, `keepAlive()`, volume support, native envVars |
| `packages/shared/src/protocol.ts` | Add chain types + `DEFAULT_CHAINS` |
| `apps/worker-agent/src/run.ts` | Return result for approval, steering poller, retry, poll interval, usage monitoring |
| `apps/worker-agent/src/agent/event-bridge.ts` | `onCheckpoint` callback |
| `apps/worker-agent/src/agent/emitter.ts` | `emitSandboxInfo()` |
| `apps/api/src/routes/internal-events.ts` | Sandbox-info endpoint, chain hooks |
| `apps/api/src/routes/agent-runs.ts` | `wait.completeToken()` for approve/reject, `chainId` param |
| `apps/api/src/services/chain.service.ts` | **New** — chain progression |

## Verification

1. **Long run**: Start agent run, verify it runs past 1 hour without timeout
2. **Approval checkpoint**: Run reaches `awaiting_approval`, verify zero compute during wait, verify instant resume on approve
3. **Sandbox lifecycle**: After approval wait, verify sandbox reconnects (no re-clone)
4. **Pipeline chain**: Create run with `chainId: "implement-and-review"`, verify implement auto-chains to review
5. **Mid-prompt steering**: Send user message during active tool execution, verify injection via `agent.steer()`
6. **Sandbox limit**: With 10 runs, verify stopped sandboxes free slots for new runs
