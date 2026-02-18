# Plan: Replace SDK-Specific Workers with Vendored pi-agent

## TL;DR

Copy the source code from `pi-mono/packages/ai` and `pi-mono/packages/agent` directly into this repo as `packages/pi-ai/` and `packages/pi-agent/`. Same pattern as `@assembly-lime/shared` — raw TypeScript source, no build step, resolved via Bun workspaces. Then build a single unified `apps/worker-agent/` that replaces both `worker-claude` and `worker-codex` with a real tool-calling agent loop, steering/follow-up for CI/CF, and provider-agnostic model switching.

**No npm packages. No external imports. Source code lives here.**

---

## Why This Is Better

### Current State (After Claude Agent SDK Migration)

worker-claude was recently migrated to `@anthropic-ai/claude-agent-sdk` (commit `e9daca1`). It now has:
- Real agent loop via `query()` with `maxTurns: 25-40`
- Built-in tools: `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`
- MCP server support (Daytona tools exposed via in-process MCP)
- Three execution modes: direct, local workspace, Daytona workspace
- Git operations + PR creation after agent completes
- Bedrock support via `CLAUDE_CODE_USE_BEDROCK=1`

worker-codex is still single-shot (raw OpenAI chat completions, no tool calling, regex diff extraction).

### Remaining Problems

| Limitation | Impact |
|---|---|
| **Claude-only agent loop** — Agent SDK only works with Anthropic models (Claude via API or Bedrock) | Can't use GPT, Gemini, or any other provider for agentic runs. Codex worker is still dumb single-shot |
| **Two separate workers** — worker-claude (Agent SDK) + worker-codex (raw OpenAI) | Different architectures, different capabilities, double maintenance |
| **No steering** — `query()` runs to completion, no way to inject mid-execution feedback | CI/CF impossible — user must wait for full run, then re-run with modified prompt |
| **No CI/CF loop** — no automated lint/test → feedback → retry after agent completes | Agent commits broken code, user must manually re-run |
| **No cross-provider handoffs** — can't start with one model and switch mid-run | Locked to one model per run |
| **Black-box tool execution** — Agent SDK's built-in tools are opaque, events only show tool names | Limited visibility into what Read/Write/Bash are doing in real-time |
| **MCP coupling** — Daytona tools use MCP protocol, tied to Agent SDK's MCP integration | Can't reuse tool definitions with non-Claude providers |
| **No thinking-level control** — Agent SDK doesn't expose thinking/reasoning budget knobs | Can't tune planning depth per mode |

### What pi-agent Still Adds

| Capability | How | vs Agent SDK |
|---|---|---|
| **Any LLM provider** | pi-ai model registry — Anthropic, OpenAI, Google, Bedrock, Mistral, Groq, xAI | Agent SDK = Claude-only |
| **One unified worker** | Single `worker-agent` handles all providers | Currently need 2 workers |
| **Steering (CF)** | `agent.steer()` interrupts mid-tool-execution | Agent SDK has no steering |
| **Follow-up (CI)** | `agent.followUp()` queues automated improvement tasks | Agent SDK runs once then exits |
| **Streaming tool events** | `tool_execution_start/update/end` → real-time UI per tool | Agent SDK only exposes final tool results |
| **Thinking-level control** | ThinkingLevel: off/minimal/low/medium/high/xhigh per model | Not configurable in Agent SDK |
| **Context transformation** | `transformContext()` hook for intelligent pruning before each LLM call | Agent SDK handles context internally, no hook |
| **Cross-provider handoffs** | Start with Sonnet for planning, switch to Opus for implementation | Not possible |
| **TypeBox tool schemas** | Type-safe tool definitions with AJV validation, portable across providers | MCP tools are Agent SDK-specific |
| **Abort/cancel** | `agent.abort()` cleanly cancels in-progress tool execution | Agent SDK abort support is limited |
| **Source code ownership** | We own the code — can modify, trim, extend | Agent SDK is a black box |

### What to Carry Forward from Agent SDK Migration

The Agent SDK migration introduced good patterns worth keeping:

| Pattern | Reuse In pi-agent |
|---|---|
| `daytona-mcp.ts` tool definitions (read/write/exec/list/delete) | Convert to `AgentTool` definitions — same operations, portable schema |
| `workspace-runner.ts` git workflow (diff → commit → push → PR) | Reuse as post-agent-loop git orchestration |
| Tool allowlisting per mode (`plan` = read-only, `implement` = full) | Reuse as `TOOLS_BY_MODE` registry |
| Bedrock env var flag (`CLAUDE_CODE_USE_BEDROCK`) | pi-ai handles Bedrock natively — just `getModel("bedrock", "...")` |
| MCP server pattern for Daytona | Not needed — pi-agent tools call Daytona SDK directly, no MCP layer |

---

## Architecture

### Before (Current — Post Agent SDK Migration)

```
┌──────────────────────┐     ┌─────────────────┐
│ worker-claude (Bun)   │     │ worker-codex     │
│                       │     │ (Node 20)        │
│ claude-agent-sdk      │     │                  │
│ ├─ query() loop       │     │ openai SDK       │
│ ├─ Built-in tools     │     │ Single-shot      │
│ │  Read/Write/Edit/   │     │ No tools         │
│ │  Bash/Glob/Grep     │     │ Regex diff       │
│ ├─ MCP (Daytona)      │     │                  │
│ ├─ Bedrock support    │     │                  │
│ └─ Claude-only        │     │                  │
└────────┬──────────────┘     └────────┬─────────┘
         │ HTTP POST                   │
         │ /internal/agent-events      │
         └───────────┬─────────────────┘
                     ▼
              ┌──────────────┐
              │ API Server   │
              │ → Postgres   │
              │ → WebSocket  │
              └──────────────┘
       Trigger.dev v3 (managed cloud queue)
```

### After (Proposed)

```
┌──────────────────────────────────────────────────┐
│ apps/trigger/agent-task.ts (Trigger.dev task)     │
│                                                   │
│ ┌─────────────────────────────────────────────┐  │
│ │ packages/pi-ai (vendored source)             │  │
│ │ Unified LLM: Anthropic, OpenAI, Google,      │  │
│ │ Bedrock, Mistral, Groq, xAI, ...            │  │
│ └─────────────────────────────────────────────┘  │
│ ┌─────────────────────────────────────────────┐  │
│ │ packages/pi-agent (vendored source)          │  │
│ │ Agent loop, tool execution, steering,        │  │
│ │ follow-up, context transform, abort          │  │
│ └─────────────────────────────────────────────┘  │
│ ┌─────────────────────────────────────────────┐  │
│ │ assemblyLime Tool Registry                   │  │
│ │ read_file, write_file, run_command,          │  │
│ │ search_code, git_diff, git_commit,           │  │
│ │ create_pr, run_tests, list_files, ...        │  │
│ └─────────────────────────────────────────────┘  │
│ ┌─────────────────────────────────────────────┐  │
│ │ Event Bridge                                 │  │
│ │ AgentEvent (pi) → AgentEvent (assemblyLime)  │  │
│ │ → HTTP POST /internal/agent-events/:runId    │  │
│ └─────────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────────┘
                       │ HTTP POST (x-internal-key auth)
                       ▼
                ┌──────────────┐
                │ API Server   │  ← unchanged
                │ → Postgres   │
                │ → WebSocket  │
                └──────────────┘
         Trigger.dev v3 (managed cloud queue)
```

---

## How the Vendored Source Works

Same pattern as `@assembly-lime/shared` — Bun resolves workspace packages from raw `.ts` source. No build step.

### packages/pi-ai/package.json

```json
{
  "name": "@assembly-lime/pi-ai",
  "version": "0.0.0",
  "private": true,
  "module": "src/index.ts",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.73.0",
    "@sinclair/typebox": "^0.34.41",
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "openai": "^6.10.0",
    "partial-json": "^0.1.7"
  }
}
```

### packages/pi-agent/package.json

```json
{
  "name": "@assembly-lime/pi-agent",
  "version": "0.0.0",
  "private": true,
  "module": "src/index.ts",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@assembly-lime/pi-ai": "workspace:*"
  }
}
```

### Import Resolution

```typescript
// In apps/worker-agent/src/agent/factory.ts:
import { Agent } from "@assembly-lime/pi-agent";   // → packages/pi-agent/src/index.ts
import { getModel } from "@assembly-lime/pi-ai";    // → packages/pi-ai/src/index.ts

// Bun workspace resolves these at runtime from source — zero build step.
```

### Root package.json (already configured)

```json
{
  "workspaces": ["apps/*", "packages/*"]
}
```

`packages/pi-ai/` and `packages/pi-agent/` are auto-discovered by the existing glob.

---

## What to Copy from pi-mono

### Source: `pi-mono/packages/ai` → `packages/pi-ai/`

**Copy these files (core engine):**

```
packages/pi-ai/
├── src/
│   ├── index.ts                          # Re-exports (trim OAuth/CLI exports)
│   ├── types.ts                          # Core types: Message, Tool, Context, etc.
│   ├── stream.ts                         # stream(), complete(), streamSimple(), completeSimple()
│   ├── models.ts                         # getModel(), getModels(), getProviders()
│   ├── models.generated.ts               # Auto-generated model registry (200+ models)
│   ├── api-registry.ts                   # Provider registration system
│   ├── env-api-keys.ts                   # Env var API key detection
│   ├── providers/
│   │   ├── anthropic.ts                  # Anthropic Messages API + thinking
│   │   ├── openai-completions.ts         # OpenAI Chat Completions (+ Mistral, Groq, xAI)
│   │   ├── openai-responses.ts           # OpenAI Responses API (o1, gpt-5)
│   │   ├── openai-responses-shared.ts    # Shared OpenAI Responses utilities
│   │   ├── google.ts                     # Google Generative AI (Gemini)
│   │   ├── google-shared.ts              # Shared Google utilities
│   │   ├── amazon-bedrock.ts             # AWS Bedrock Converse API
│   │   ├── transform-messages.ts         # Cross-provider message transformation
│   │   ├── simple-options.ts             # Reasoning/thinking budget helpers
│   │   └── register-builtins.ts          # Provider registration on import
│   └── utils/
│       ├── event-stream.ts               # Async event stream + AssistantMessageEventStream
│       ├── validation.ts                 # AJV tool argument validation
│       ├── json-parse.ts                 # Partial JSON for streaming tool calls
│       ├── overflow.ts                   # Context overflow detection
│       ├── sanitize-unicode.ts           # Unicode surrogate pair cleanup
│       └── typebox-helpers.ts            # StringEnum() for Google compat
├── package.json
└── tsconfig.json
```

**Do NOT copy (trim these):**

| File | Reason |
|---|---|
| `src/cli.ts` | OAuth CLI login — server-side workers use env API keys |
| `src/utils/oauth/` | All OAuth flows — not needed for server workers |
| `src/utils/http-proxy.ts` | HTTP proxy setup — not needed in our infra |
| `src/providers/github-copilot-headers.ts` | Copilot-specific auth |
| `src/providers/google-gemini-cli.ts` | CLI-specific Google auth |
| `src/providers/google-vertex.ts` | Vertex AI — add later if needed |
| `src/providers/azure-openai-responses.ts` | Azure — add later if needed |
| `src/providers/openai-codex-responses.ts` | ChatGPT Pro sessions — not relevant |
| `README.md`, `CHANGELOG.md` | Upstream docs |
| `test/` | Upstream tests — we'll write our own |
| `scripts/` | Model generation scripts |

**After trimming: ~12,000 lines** (down from ~22,600).

### Source: `pi-mono/packages/agent` → `packages/pi-agent/`

**Copy all source files (it's small ~2,000 lines):**

```
packages/pi-agent/
├── src/
│   ├── index.ts           # Public exports
│   ├── types.ts           # AgentMessage, AgentEvent, AgentTool, AgentState, etc.
│   ├── agent.ts           # Agent class — state management, prompt(), steer(), followUp()
│   ├── agent-loop.ts      # Core loop: agentLoop(), agentLoopContinue(), runLoop()
│   └── proxy.ts           # streamProxy — keep for future browser-to-backend proxying
├── package.json
└── tsconfig.json
```

### Post-Copy Modifications

1. **`packages/pi-ai/src/index.ts`** — Remove OAuth exports, CLI exports. Keep only:
   - `stream`, `complete`, `streamSimple`, `completeSimple`
   - `getModel`, `getModels`, `getProviders`, `calculateCost`
   - All type exports
   - `validateToolCall`, `validateToolArguments`
   - `Type`, `Static`, `TSchema` re-exports from TypeBox
   - `getEnvApiKey`

2. **`packages/pi-ai/src/providers/register-builtins.ts`** — Remove registrations for trimmed providers (Copilot, Vertex, Azure, Codex).

3. **`packages/pi-ai/src/env-api-keys.ts`** — Remove OAuth-related key resolution. Keep only direct env var lookups (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `AWS_*`).

4. **`packages/pi-agent/src/index.ts`** — Change import from `@mariozechner/pi-ai` → `@assembly-lime/pi-ai`.

5. **`packages/pi-agent/src/agent-loop.ts`** — Same import path change.

6. **`packages/pi-agent/src/types.ts`** — Same import path change.

7. **`packages/pi-agent/src/proxy.ts`** — Same import path change.

### Dependency Tree After Vendoring

```
apps/worker-agent/
  └─ @assembly-lime/pi-agent  (workspace:* → packages/pi-agent/src/)
       └─ @assembly-lime/pi-ai  (workspace:* → packages/pi-ai/src/)
            ├─ @anthropic-ai/sdk       (npm — HTTP calls to Anthropic API)
            ├─ openai                   (npm — HTTP calls to OpenAI API)
            ├─ @sinclair/typebox        (npm — schema definitions)
            ├─ ajv + ajv-formats        (npm — tool arg validation)
            └─ partial-json             (npm — streaming JSON parse)
  └─ @assembly-lime/shared     (workspace:* → packages/shared/src/)
  └─ bunqueue                  (npm — SQLite-backed job queue client)
  └─ pino                      (npm — logging)
```

**No Redis.** Queue uses bunqueue (SQLite-backed, BullMQ-compatible API). Event streaming uses HTTP POST to `POST /internal/agent-events/:runId` with `x-internal-key` auth. Provider SDKs (`@anthropic-ai/sdk`, `openai`) are still npm dependencies — they're HTTP clients for the LLM APIs. The agent framework code itself is fully vendored source.

---

## New Worker: `apps/worker-agent/`

### Structure

```
apps/worker-agent/
├── src/
│   ├── main.ts                    # bunqueue consumer + dispatcher
│   ├── lib/
│   │   └── logger.ts              # Pino logger
│   ├── agent/
│   │   ├── factory.ts             # Create Agent with model + tools per job
│   │   ├── event-bridge.ts        # pi AgentEvent → assemblyLime AgentEvent → HTTP POST
│   │   ├── model-resolver.ts      # AgentProviderId + mode → pi-ai Model
│   │   └── context-transform.ts   # transformContext for long-running pruning
│   ├── tools/
│   │   ├── index.ts               # Tool registry — buildTools(workDir, mode)
│   │   ├── file-read.ts           # read_file tool
│   │   ├── file-write.ts          # write_file tool
│   │   ├── file-list.ts           # list_files tool
│   │   ├── search-code.ts         # search_code (grep) tool
│   │   ├── run-command.ts         # run_command (sandboxed shell) tool
│   │   ├── git-diff.ts            # git_diff tool
│   │   ├── git-commit.ts          # git_commit tool
│   │   ├── create-pr.ts           # create_pr tool
│   │   └── run-tests.ts           # run_tests tool
│   ├── sandbox/
│   │   ├── daytona.ts             # Daytona sandbox adapter (reuse from worker-claude)
│   │   ├── k8s.ts                 # K8s adapter (reuse)
│   │   └── local.ts               # Local/direct execution (dev mode)
│   └── git/
│       ├── git-operations.ts      # Reuse from worker-claude
│       └── pr-creator.ts          # Reuse from worker-claude
├── package.json
└── tsconfig.json
```

### apps/worker-agent/package.json

```json
{
  "name": "@assembly-lime/worker-agent",
  "version": "0.0.0",
  "module": "src/main.ts",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "bun run --env-file ../../.env --watch src/main.ts"
  },
  "dependencies": {
    "@assembly-lime/shared": "workspace:*",
    "@assembly-lime/pi-ai": "workspace:*",
    "@assembly-lime/pi-agent": "workspace:*",
    "@daytonaio/sdk": "^0.143.0",
    "@kubernetes/client-node": "^1.0.0",
    "bunqueue": "latest",
    "pino": "^9.6.0",
    "pino-pretty": "^13.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

### Core: Agent Factory (`agent/factory.ts`)

```typescript
import { Agent } from "@assembly-lime/pi-agent";
import { getModel } from "@assembly-lime/pi-ai";
import { AgentJobPayload } from "@assembly-lime/shared";
import { AgentEventEmitter } from "./event-bridge";
import { resolveModel } from "./model-resolver";
import { buildTools } from "../tools";
import { createContextTransform } from "./context-transform";

export async function createAgent(
  payload: AgentJobPayload,
  workDir: string,
  emitter: AgentEventEmitter
): Promise<Agent> {
  const model = resolveModel(payload.provider, payload.mode);
  const tools = buildTools(workDir, payload);
  const bridge = createEventBridge(emitter);

  const agent = new Agent({
    initialState: {
      systemPrompt: payload.resolvedPrompt,
      model,
      thinkingLevel: payload.mode === "plan" ? "high" : "medium",
      tools,
    },
    getApiKey: (provider) => {
      // Direct env var lookup — no OAuth, no external service
      const map: Record<string, string> = {
        anthropic: process.env.ANTHROPIC_API_KEY ?? "",
        openai: process.env.OPENAI_API_KEY ?? "",
        google: process.env.GOOGLE_API_KEY ?? "",
      };
      return map[provider];
    },
    transformContext: createContextTransform(payload.constraints),
  });

  agent.subscribe(bridge);
  return agent;
}
```

### Core: Event Bridge (`agent/event-bridge.ts`)

Maps pi-agent's rich event model to assemblyLime's existing `AgentEvent` protocol. Events are sent via HTTP POST to the API's internal endpoint (`POST /internal/agent-events/:runId`), authenticated with `x-internal-key`. The API persists events to Postgres and broadcasts to WebSocket — all unchanged:

```typescript
import type { AgentEvent as PiAgentEvent } from "@assembly-lime/pi-agent";
import type { AgentEvent } from "@assembly-lime/shared/protocol";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost:3434").replace(/\/$/, "");
const INTERNAL_KEY = process.env.INTERNAL_AGENT_API_KEY ?? "";

export class AgentEventEmitter {
  private url: string;

  constructor(private runId: number) {
    this.url = `${API_BASE_URL}/internal/agent-events/${runId}`;
  }

  async emit(event: AgentEvent): Promise<void> {
    await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-key": INTERNAL_KEY,
      },
      body: JSON.stringify(event),
    });
  }
}

export function createEventBridge(emitter: AgentEventEmitter) {
  return async (event: PiAgentEvent) => {
    switch (event.type) {
      case "agent_start":
        await emitter.emit({ type: "status", status: "running" });
        break;

      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          await emitter.emit({
            type: "message", role: "assistant",
            text: event.assistantMessageEvent.delta,
          });
        }
        if (event.assistantMessageEvent.type === "thinking_delta") {
          await emitter.emit({
            type: "thinking",
            text: event.assistantMessageEvent.delta,
          });
        }
        break;

      case "tool_execution_start":
        await emitter.emit({
          type: "tool_start",
          toolName: event.toolName,
          args: event.args,
        });
        break;

      case "tool_execution_update":
        await emitter.emit({
          type: "tool_progress",
          toolName: event.toolName,
          partialResult: event.partialResult,
        });
        break;

      case "tool_execution_end":
        await emitter.emit({
          type: "tool_end",
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
        });
        if (event.toolName === "git_diff" && !event.isError) {
          await emitter.emit({
            type: "diff",
            unifiedDiff: event.result?.content?.[0]?.text ?? "",
          });
        }
        break;

      case "agent_end":
        await emitter.emit({ type: "status", status: "completed" });
        break;
    }
  };
}
```

### Core: Model Resolver (`agent/model-resolver.ts`)

```typescript
import { getModel, type Model } from "@assembly-lime/pi-ai";

const MODEL_MAP: Record<string, Record<string, string>> = {
  claude: {
    plan:      "claude-sonnet-4-5-20250929",
    implement: "claude-sonnet-4-5-20250929",
    bugfix:    "claude-sonnet-4-5-20250929",
    review:    "claude-sonnet-4-5-20250929",
  },
  codex: {
    plan:      "gpt-4o",
    implement: "gpt-4o",
    bugfix:    "gpt-4o",
    review:    "gpt-4o",
  },
  gemini: {
    plan:      "gemini-2.5-pro",
    implement: "gemini-2.5-pro",
    bugfix:    "gemini-2.5-flash",
    review:    "gemini-2.5-flash",
  },
};

export function resolveModel(provider: string, mode: string): Model<any> {
  const modelId = MODEL_MAP[provider]?.[mode];
  if (!modelId) throw new Error(`No model for ${provider}/${mode}`);
  const piProvider = provider === "codex" ? "openai" : provider;
  return getModel(piProvider, modelId);
}
```

### Core: Tool Definitions (Converted from daytona-mcp.ts)

The existing `daytona-mcp.ts` exposes 5 Daytona tools via MCP (Agent SDK-specific). These convert directly to portable `AgentTool` definitions that work with any LLM provider:

**`tools/file-read.ts`** — replaces `daytona_read_file` MCP tool:

```typescript
import type { AgentTool } from "@assembly-lime/pi-agent";
import { Type } from "@assembly-lime/pi-ai";
import { readFile } from "fs/promises";
import { join, resolve } from "path";

export function createReadFileTool(workDir: string): AgentTool {
  return {
    name: "read_file",
    label: "Read File",
    description: "Read the contents of a file in the workspace",
    parameters: Type.Object({
      path: Type.String({ description: "Relative path from workspace root" }),
    }),
    async execute(toolCallId, { path }, signal) {
      const absPath = resolve(join(workDir, path));
      if (!absPath.startsWith(workDir)) {
        return {
          content: [{ type: "text", text: "Error: path escapes workspace" }],
          isError: true,
        };
      }
      const content = await readFile(absPath, "utf-8");
      return { content: [{ type: "text", text: content }] };
    },
  };
}
```

**Sandbox-aware variant** — for Daytona/K8s, tools route through workspace SDK instead of local FS:

```typescript
// tools/file-read.ts — sandbox mode
export function createReadFileTool(workspace: DaytonaWorkspace): AgentTool {
  return {
    name: "read_file",
    label: "Read File",
    description: "Read the contents of a file in the workspace",
    parameters: Type.Object({
      path: Type.String({ description: "Relative path from workspace root" }),
    }),
    async execute(toolCallId, { path }, signal) {
      // Same as daytona-mcp.ts daytona_read_file — but as AgentTool, not MCP
      const content = await workspace.readFile(path);
      if (content === null) {
        return { content: [{ type: "text", text: `File not found: ${path}` }], isError: true };
      }
      return { content: [{ type: "text", text: content }] };
    },
  };
}
```

**MCP-to-AgentTool conversion map:**

| daytona-mcp.ts (current) | AgentTool (pi-agent) |
|---|---|
| `daytona_read_file` | `read_file` (workspace.readFile) |
| `daytona_write_file` | `write_file` (workspace.writeFile) |
| `daytona_delete_file` | `delete_file` (workspace.deleteFile) |
| `daytona_exec` | `run_command` (workspace.exec) |
| `daytona_list_files` | `list_files` (workspace.exec "find") |
| Agent SDK built-in `Read` | `read_file` (local fs.readFile) |
| Agent SDK built-in `Write`/`Edit` | `write_file` (local fs.writeFile) |
| Agent SDK built-in `Bash` | `run_command` (local child_process) |
| Agent SDK built-in `Glob` | `list_files` (local glob) |
| Agent SDK built-in `Grep` | `search_code` (local ripgrep) |

---

## CI/CF (Continuous Improvement / Continuous Feedback) Design

pi-agent's steering and follow-up queues map directly to CI/CF:

### Continuous Feedback (Steering)

User or automated system interrupts the agent mid-execution:

```
Agent is implementing feature...
  └─ LLM decides to write code
  └─ tool: write_file("src/api.ts", code)  ← executing
  └─ STEERING MESSAGE arrives: "Also add input validation with Zod"
  └─ Agent receives steering, skips remaining tools, adjusts approach
  └─ Continues with new instructions incorporated
```

**Implementation:**

Steering uses the same HTTP POST pattern — API stores steering messages, worker polls for them:

```typescript
// API route: POST /agent-runs/:id/steer
// Stores the steering message in a lightweight in-memory map (or DB row)
app.post("/agent-runs/:id/steer", async ({ params, body }) => {
  const { message } = body;
  pendingSteeringMessages.set(Number(params.id), {
    role: "user",
    content: [{ type: "text", text: message }],
    timestamp: Date.now(),
  });
  return { ok: true };
});

// API route: GET /internal/agent-steer/:runId (worker polls this)
app.get("/internal/agent-steer/:runId", async ({ params, headers, set }) => {
  if (!verifyInternalKey(headers["x-internal-key"])) {
    set.status = 401;
    return { error: "unauthorized" };
  }
  const msg = pendingSteeringMessages.get(Number(params.runId));
  if (msg) {
    pendingSteeringMessages.delete(Number(params.runId));
    return { message: msg };
  }
  return { message: null };
});

// Worker: pi-agent's getSteeringMessages config polls the API
const agent = new Agent({
  // ...
  getSteeringMessages: async () => {
    const res = await fetch(
      `${API_BASE_URL}/internal/agent-steer/${runId}`,
      { headers: { "x-internal-key": INTERNAL_KEY } }
    );
    const { message } = await res.json();
    return message ? [message] : [];
  },
});
```

### Continuous Improvement (Follow-up)

After agent completes a pass, automated checks queue improvement tasks:

```
Agent finishes implementing feature
  └─ agent_end event
  └─ CI checks run automatically:
      - Linter → 3 issues
      - Tests → 2 failures
  └─ FOLLOW-UP queued: "Fix lint issues and test failures: [details]"
  └─ Agent resumes with full context, fixes issues
  └─ Repeat until clean or max iterations reached
```

**Implementation:**

```typescript
agent.subscribe(async (event) => {
  if (event.type === "agent_end") {
    const lint = await runLint(workDir);
    const tests = await runTests(workDir);

    if (lint.errors.length > 0 || tests.failures.length > 0) {
      const feedback = buildCIFeedback(lint, tests);
      agent.followUp({
        role: "user",
        content: [{ type: "text", text: feedback }],
        timestamp: Date.now(),
      });
      await agent.continue();  // Agent picks up follow-up
    }
  }
});
```

### CI/CF Loop Architecture

```
┌─────────────────────────────────────────────────┐
│ Agent Run Lifecycle                              │
│                                                  │
│  User Prompt                                     │
│    ↓                                             │
│  ┌──────────────────────────────────────────┐   │
│  │ Agent Loop (packages/pi-agent — vendored) │   │
│  │                                           │   │
│  │  Turn 1: Plan                             │   │
│  │    ├─ LLM response (thinking + plan)      │   │
│  │    ├─ read_file, search_code              │   │
│  │    └─ ← STEER? (user feedback)            │   │
│  │                                           │   │
│  │  Turn 2: Implement                        │   │
│  │    ├─ write_file (multiple files)         │   │
│  │    ├─ run_tests                           │   │
│  │    └─ ← STEER? (user feedback)            │   │
│  │                                           │   │
│  │  Turn 3: Fix test failures (self-correct) │   │
│  │    ├─ read test output                    │   │
│  │    ├─ write_file (fix)                    │   │
│  │    └─ run_tests (pass)                    │   │
│  │                                           │   │
│  │  Turn N: Commit + PR                      │   │
│  │    ├─ git_commit                          │   │
│  │    └─ create_pr                           │   │
│  │                                           │   │
│  └──────────────────────────────────────────┘   │
│    ↓ agent_end                                   │
│  ┌──────────────────────────────────────────┐   │
│  │ CI/CF Feedback Loop                       │   │
│  │                                           │   │
│  │  1. Run linter → issues?                  │   │
│  │  2. Run tests → failures?                 │   │
│  │  3. Check code coverage → decreased?      │   │
│  │  4. Security scan → vulnerabilities?      │   │
│  │                                           │   │
│  │  If issues found:                         │   │
│  │    agent.followUp(feedback)               │   │
│  │    agent.continue()                       │   │
│  │    → re-enters Agent Loop                 │   │
│  │                                           │   │
│  │  If clean:                                │   │
│  │    → Mark run completed                   │   │
│  │    → Final PR update                      │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

## Protocol Changes

### Extended AgentProviderId

```typescript
// packages/shared/src/protocol.ts
export type AgentProviderId = "claude" | "codex" | "gemini" | "bedrock";
```

### New AgentEvent Types

Add to the existing union (backwards compatible — UI ignores unknown types):

```typescript
| { type: "tool_start"; toolName: string; args: Record<string, unknown> }
| { type: "tool_progress"; toolName: string; partialResult: unknown }
| { type: "tool_end"; toolName: string; result: unknown; isError: boolean }
| { type: "thinking"; text: string }
| { type: "steering_received"; message: string }
| { type: "followup_queued"; message: string }
| { type: "turn"; turnNumber: number; action: "start" | "end" }
```

### New API Routes

```
POST /agent-runs/:id/steer     — Send steering message to running agent
POST /agent-runs/:id/followup  — Queue follow-up task for agent
POST /agent-runs/:id/abort     — Cancel running agent
GET  /agent-runs/:id/state     — Get current agent state (messages, tools, model)
```

### New DB Columns

```sql
ALTER TABLE agent_runs ADD COLUMN model_id TEXT;
ALTER TABLE agent_runs ADD COLUMN thinking_level TEXT;
ALTER TABLE agent_runs ADD COLUMN turn_count INTEGER DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN tool_calls_count INTEGER DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN steering_count INTEGER DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN followup_count INTEGER DEFAULT 0;
```

---

## Queue Changes

### Single Queue via bunqueue (Replaces Two)

```typescript
import { Queue, Worker } from "bunqueue/client";

const connection = {
  host: process.env.BUNQUEUE_HOST ?? "localhost",
  port: Number(process.env.BUNQUEUE_PORT) || 6789,
};

// Before: two separate queues
QUEUE_AGENT_RUNS_CLAUDE = "agent-runs-claude"
QUEUE_AGENT_RUNS_CODEX  = "agent-runs-codex"

// After: single queue, provider is in payload
QUEUE_AGENT_RUNS = "agent-runs"
const agentQueue = new Queue<AgentJobPayload>(QUEUE_AGENT_RUNS, { connection });
```

### Steering via HTTP (No Redis pub/sub)

```typescript
// Worker polls for steering messages via HTTP
GET /internal/agent-steer/:runId    — Worker polls, returns pending steering message or null
POST /agent-runs/:id/steer          — UI/user pushes steering message
```

### Environment Variables

```
BUNQUEUE_HOST=localhost              # bunqueue TCP server
BUNQUEUE_PORT=6789                   # bunqueue TCP port
API_BASE_URL=http://localhost:3434   # For worker → API HTTP callbacks
INTERNAL_AGENT_API_KEY=...           # Shared secret for x-internal-key auth
```

---

## Tool Registry

### Workspace Tools (Core)

| Tool | Description | Sandbox-aware |
|---|---|---|
| `read_file` | Read file contents | Yes — uses sandbox FS |
| `write_file` | Create/overwrite file | Yes |
| `list_files` | List directory contents (glob) | Yes |
| `search_code` | Grep/ripgrep across codebase | Yes |
| `run_command` | Execute shell command (sandboxed) | Yes — uses sandbox shell |

### Git Tools

| Tool | Description |
|---|---|
| `git_status` | Show working tree status |
| `git_diff` | Get unified diff |
| `git_commit` | Stage all + commit with message |
| `git_push` | Push to remote |
| `create_pr` | Create GitHub pull request |

### CI/CF Tools

| Tool | Description |
|---|---|
| `run_tests` | Run project test suite, return results |
| `run_lint` | Run linter, return issues |
| `check_types` | Run type checker (tsc, mypy, etc.) |

### Mode-Specific Tool Sets

```typescript
const TOOLS_BY_MODE: Record<AgentMode, string[]> = {
  plan:      ["read_file", "list_files", "search_code"],
  implement: ["read_file", "write_file", "list_files", "search_code", "run_command",
              "git_status", "git_diff", "git_commit", "git_push", "create_pr",
              "run_tests", "run_lint", "check_types"],
  bugfix:    ["read_file", "write_file", "list_files", "search_code", "run_command",
              "run_tests", "git_status", "git_diff", "git_commit", "git_push", "create_pr"],
  review:    ["read_file", "list_files", "search_code", "git_diff", "run_tests"],
};
```

---

## Migration Strategy

### Phase 1: Vendor the Source (No Breaking Changes)

1. `cp -r pi-mono/packages/ai/src packages/pi-ai/src`
2. `cp -r pi-mono/packages/agent/src packages/pi-agent/src`
3. Create `packages/pi-ai/package.json` (shown above — private, no build, `"main": "src/index.ts"`)
4. Create `packages/pi-agent/package.json` (shown above)
5. Trim `packages/pi-ai/src/index.ts` — remove OAuth/CLI exports
6. Trim `packages/pi-ai/src/providers/register-builtins.ts` — remove unused providers
7. Trim `packages/pi-ai/src/env-api-keys.ts` — remove OAuth key resolution
8. Delete `packages/pi-ai/src/cli.ts`, `src/utils/oauth/`, `src/utils/http-proxy.ts`
9. Delete trimmed provider files (Copilot, Vertex, Azure, Codex)
10. Find-replace `@mariozechner/pi-ai` → `@assembly-lime/pi-ai` in `packages/pi-agent/src/`
11. `bun install` — workspace resolution picks up both packages
12. Verify: `bun run -e "import { getModel } from '@assembly-lime/pi-ai'; console.log(getModel('anthropic', 'claude-sonnet-4-5-20250929'))"`

### Phase 2: Build worker-agent (Parallel to Existing Workers)

1. Create `apps/worker-agent/` with structure shown above
2. Build event bridge (pi events → assemblyLime events → HTTP POST `/internal/agent-events/:runId`)
3. Convert `daytona-mcp.ts` tools to `AgentTool` definitions (read/write/exec/list/delete)
4. Add local-mode tools using built-in FS (same operations as Agent SDK's Read/Write/Edit/Bash/Glob/Grep)
5. Implement git tools: `git_diff`, `git_commit`, `create_pr` (reuse from `worker-claude/src/git/`)
6. Port post-agent git workflow from `workspace-runner.ts` (diff → commit → push → PR)
7. Port tool allowlisting per mode from `claude-runner.ts` (`plan` = read-only, `implement` = full)
8. Wire up bunqueue `Worker` consumer on `agent-runs` queue
9. Test with local/direct execution mode — verify parity with Agent SDK output
10. Old workers continue running on old queues — zero downtime

### Phase 3: CI/CF Feedback Loop

1. Add API routes: `GET /internal/agent-steer/:runId` (worker polls), `POST /agent-runs/:id/steer` (UI pushes)
2. Add API routes: `POST /agent-runs/:id/followup`, `POST /agent-runs/:id/abort`
3. Implement automated CI feedback (lint + test after `agent_end`)
4. Add follow-up loop with max iteration guard (default: 5 CI/CF rounds)
5. Update UI: show tool execution timeline, thinking blocks, steering input

### Phase 4: Sandbox Integration (Port Daytona + K8s)

1. Port Daytona adapter — tools call `DaytonaWorkspace` SDK directly (no MCP layer)
2. Port K8s adapter — tools execute via K8s exec API
3. Tools auto-detect sandbox mode from job payload (same `payload.sandbox.provider` field)
4. Port dev server + preview workflow from `daytona-workspace-runner.ts` (`startDevServerAndPreview`)
5. Port sandbox registration from `daytona-workspace-runner.ts` (`POST /sandboxes/register-internal`)

### Phase 5: Deprecate Old Workers

1. Route all new runs to `agent-runs` queue
2. Drain old queues (keep old workers alive until empty)
3. Remove `apps/worker-claude/` and `apps/worker-codex/`
4. Remove `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/sdk`, and `openai` from worker deps (pi-ai handles all providers)
5. Update root `package.json` build scripts and `ecosystem.config.cjs` PM2 config

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Vendored code diverges from upstream pi-mono | We own it now — that's the point. Cherry-pick upstream improvements as needed |
| pi-ai is ~12K LOC after trimming — large surface | Well-structured. Provider files are independent. Can delete any provider file without breaking others |
| Tool execution in worker process is unsafe | Sandbox tools via Daytona/K8s. Local mode is dev-only |
| Long-running agent could loop forever | `constraints.timeBudgetSec` + max turn count (default 50) + max CI/CF rounds (default 5) |
| Agent costs could spiral | Track `Usage` from pi-ai per turn. Enforce `constraints.maxCostCents`. Auto-abort on budget exceeded |
| Breaking change to existing queue protocol | Phase 2 runs parallel — old workers keep processing old queues |
| HTTP event POST could fail (network/API down) | Retry with exponential backoff in `AgentEventEmitter.emit()`. Buffer events if API unreachable |
| Agent SDK already works well for Claude runs | pi-agent matches Agent SDK capability while adding steering, CI/CF, and multi-provider. Worth the switch |
| Losing Agent SDK's built-in tools (Read/Write/Edit/Bash) | pi-agent tools implement identical operations. Local tools use same FS calls. Daytona tools port from daytona-mcp.ts |

---

## Estimated Scope

| Phase | Work | Effort |
|---|---|---|
| Phase 1: Vendor source | Copy ~55 files, trim ~10, edit ~8 imports | Small |
| Phase 2: worker-agent | Create ~18 new files (incl. tool ports from daytona-mcp.ts + workspace-runner.ts) | Medium |
| Phase 3: CI/CF loop | Create ~8 files, modify ~4 existing | Medium |
| Phase 4: Sandbox integration | Port Daytona + K8s + dev server preview, ~8 files | Medium |
| Phase 5: Deprecation | Delete ~40 files (both workers + Agent SDK + MCP), modify ~3 | Small |

---

## Verdict

**Yes — vendor the source, replace both workers with one.**

worker-claude's Agent SDK migration was a step in the right direction (real agent loop, tools, MCP), but it locked the agent to Claude-only and doesn't support steering or CI/CF. pi-agent preserves all the gains while unlocking:

- **Any LLM** — one worker handles Claude, GPT, Gemini, Bedrock (Agent SDK = Claude-only)
- **Steering (CF)** — interrupt mid-execution with user feedback (Agent SDK = run to completion)
- **Follow-up (CI)** — automated lint/test → fix loops (Agent SDK = one-and-done)
- **Portable tools** — same tool definitions work with every provider (MCP tools = Agent SDK-specific)
- **Streaming visibility** — `tool_execution_start/update/end` events per tool call (Agent SDK = opaque)
- **Thinking control** — tune reasoning budget per mode/model (Agent SDK = no knobs)
- **Full ownership** — source is in our repo, modify at will, no SDK version drift
- **Zero infra changes** — bunqueue (SQLite) + HTTP POST → Postgres + WebSocket all unchanged
