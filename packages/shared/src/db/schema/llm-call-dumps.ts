import {
  pgTable,
  bigint,
  integer,
  text,
  real,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { agentRuns } from "./agents";

export const llmCallDumps = pgTable(
  "llm_call_dumps",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    agentRunId: bigint("agent_run_id", { mode: "number" })
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    turnNumber: integer("turn_number").notNull(),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    systemPromptHash: text("system_prompt_hash"),
    messagesJson: jsonb("messages_json"),
    responseJson: jsonb("response_json"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    costCents: real("cost_cents").notNull().default(0),
    stopReason: text("stop_reason"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("llm_call_dumps_tenant_run_idx").on(t.tenantId, t.agentRunId),
    index("llm_call_dumps_tenant_created_idx").on(t.tenantId, t.createdAt),
  ]
);
