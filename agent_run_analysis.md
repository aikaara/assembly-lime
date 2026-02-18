# Agent Runs Analysis - Plan Mode & Repository Selection Issue

## Issue Summary
User ran agent run 26 with provider "codex" and mode "plan", but no repositories were selected and no sub-agents/tasks were created.

## Key Findings

### 1. Agent Run Creation Flow (createAgentRun)
**File:** `apps/api/src/services/agent-run.service.ts`

#### What happens currently:
1. **Line 48-80**: Create agent_runs record with resolved prompt
2. **Line 84-115**: Auto-resolve repositories when:
   - `SANDBOX_PROVIDER=daytona` OR `DAYTONA_API_KEY` is set
   - AND no explicit `repo` was provided
3. **Line 90**: Call `resolveReposForRun(db, tenantId, projectId)` 
4. **Line 91-92**: If zero repos found → **ERROR: "No repositories linked to this project — cannot run agent without a sandbox"**
5. **Line 94-104**: If 1 repo found → Promote to single-repo path
6. **Line 109-114**: If >1 repo found → Set payload.repos array (for multi-repo)
7. **Line 117-149**: Build AgentJobPayload with either:
   - `payload.repo` (single repo)
   - `payload.repos` (multiple repos)
   - `undefined` (neither)

#### The Problem:
- When repos are resolved as an array (>1), it's stored in `payload.repos`, NOT `payload.repo`
- The actual Trigger.dev task execution checks for `payload.repo` at line 22 of codex-agent.ts
- **Codex agent never handles `payload.repos` (multi-repo array)** - see codex-agent.ts line 22

### 2. Repository Resolution Logic (resolveReposForRun)
**File:** `apps/api/src/services/multi-repo.service.ts` lines 22-91

Resolution order:
1. If `featureId` provided → search `feature_repository_map`
2. Fallback → search `project_repositories` (explicit project-repo links)
3. Final fallback → all tenant repos where `isEnabled = true`

**Critical Issue:** If the project has NO repositories linked:
- Step 1 skipped (no featureId)
- Step 2 returns empty (no project_repositories rows)
- Step 3 returns all tenant repos, BUT if tenant has 0 repos → returns []
- If [] returned, createAgentRun throws error at line 92

### 3. Codex Agent Task Execution
**File:** `apps/trigger/codex-agent.ts`

The task has three execution paths:
1. **Lines 22-112**: Daytona workspace path
   - Requires: `payload.sandbox?.provider === "daytona"` AND `payload.repo`
   - Only handles SINGLE repo, not multi-repo
2. **Lines 115-119**: K8s delegation
   - When `USE_K8S_SANDBOX=true`
3. **Lines 121-124**: Direct execution mode (dev)
   - Just calls `runCodexAgent(payload, emitter)`

**Critical Gap:** NO CODE PATH HANDLES:
- `payload.repos` (multi-repo array) from Daytona resolution
- `payload.mode === "plan"` orchestration logic
- Sub-task creation/fanning out

### 4. Unused Orchestration Service
**File:** `apps/api/src/services/orchestrator.service.ts`

Functions exported but NEVER IMPORTED OR USED:
- `createParentRun()` - creates parent run record with `orchestrationMode`
- `fanOutSubRuns()` - creates child runs and dispatches them
- `checkParentCompletion()` - marks parent complete when all children done
- `getRunHierarchy()` and `listChildRuns()`

**Schema fields exist but unused:**
- `agent_runs.parentRunId` - for tracking hierarchies
- `agent_runs.orchestrationMode` - for "parallel" vs "sequential"

### 5. Claude Agent Has Multi-Repo Support (But Codex Doesn't)
**File:** `apps/trigger/claude-agent.ts` lines 62-66

```typescript
if (payload.repos && payload.repos.length > 0) {
  await runClaudeAgentMultiRepo(payload, emitter);
} else {
  await runClaudeAgent(payload, emitter);
}
```

Claude agent includes `runClaudeAgentMultiRepo()` which:
- Loops through `payload.repos`
- Creates individual `runClaudeAgent()` calls for each repo
- Emits system message about multi-repo run

**Codex agent has NO equivalent logic.**

### 6. Plan Mode Behavior
Plan mode is currently only used to:
- **Claude (daytona):** Create DRAFT pull requests (daytona-workspace-runner.ts:144)
- **Claude (regular):** Restrict tools to read-only: ["Read", "Glob", "Grep"] (claude-runner.ts:19-21)
- **Codex (regular):** No special handling

**Missing:** No orchestration/sub-agent spawning for plan mode in ANY path.

## What Should Happen (Expected Behavior)

### For Run 26 (codex provider, plan mode, no repos selected):

The system should either:

**Option A - Require Explicit Repo Selection:**
- When creating agent run in UI, enforce repository selection
- Block run creation if mode="plan" and no repos selected
- Return error: "Plan mode requires repository selection"

**Option B - Implement Plan Mode Orchestration (Full Multi-Repo Planning):**
1. Detect `mode === "plan"` in createAgentRun
2. Resolve all repos for the project (via resolveReposForRun)
3. Call `createParentRun()` with `orchestrationMode: "parallel"`
4. Call `fanOutSubRuns()` to create child runs, one per repository
5. Return parent run ID to UI (shows aggregated progress)
6. Each child runs independently with `parentRunId` link
7. On completion, `checkParentCompletion()` aggregates results

**Option C - Multi-Repo Planning with Claude SDK Only:**
- Codex agent (OpenAI) doesn't support the multi-turn planning needed
- Only support plan mode with Claude provider
- Block codex + plan mode combinations in UI

## Current State Summary

**What exists:**
- ✓ Repo resolution logic (resolveReposForRun)
- ✓ Multi-repo payload structure (payload.repos)
- ✓ Schema for run hierarchies (parentRunId, orchestrationMode)
- ✓ Orchestrator service functions (unused)
- ✓ Claude multi-repo execution path

**What's missing:**
- ✗ Codex multi-repo execution path (codex-agent.ts)
- ✗ Plan mode orchestration triggering (never calls createParentRun/fanOutSubRuns)
- ✗ Child run aggregation in UI
- ✗ Mode-based orchestration decision logic
- ✗ Repository selection validation in API

## Files Involved

**API:**
- `apps/api/src/services/agent-run.service.ts` - Run creation + dispatch
- `apps/api/src/services/orchestrator.service.ts` - Unused parent/child management
- `apps/api/src/services/multi-repo.service.ts` - Repo resolution
- `apps/api/src/routes/agent-runs.ts` - POST /agent-runs endpoint

**Workers:**
- `apps/trigger/codex-agent.ts` - Codex task execution (missing multi-repo)
- `apps/trigger/claude-agent.ts` - Claude task execution (has multi-repo)
- `apps/worker-codex/src/agent/codex-runner.ts` - Codex inference
- `apps/worker-claude/src/agent/multi-repo-runner.ts` - Claude multi-repo orchestration

**Schema:**
- `packages/shared/src/db/schema/agents.ts` - agent_runs, agentRunRepos, codeDiffs
- `packages/shared/src/protocol.ts` - AgentJobPayload type definition

**Shared:**
- `packages/shared/src/prompts/` - Instruction resolution (resolvePrompt)
