import {
  pgTable,
  bigint,
  text,
  timestamp,
  jsonb,
  customType,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { projects } from "./projects";
import { tickets } from "./projects";
import { repositories } from "./connectors";

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id),
    ticketId: bigint("ticket_id", { mode: "number" }).references(() => tickets.id),
    provider: text("provider").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    inputPrompt: text("input_prompt").notNull(),
    outputSummary: text("output_summary"),
    artifactsJson: jsonb("artifacts_json").notNull().default({}),
    costCents: bigint("cost_cents", { mode: "number" }).notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_runs_tenant_project_created_idx").on(
      t.tenantId,
      t.projectId,
      t.createdAt
    ),
    index("agent_runs_tenant_status_idx").on(t.tenantId, t.status),
    index("agent_runs_tenant_provider_mode_idx").on(t.tenantId, t.provider, t.mode),
  ]
);

export const agentEvents = pgTable(
  "agent_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    agentRunId: bigint("agent_run_id", { mode: "number" })
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    type: text("type").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
  },
  (t) => [
    index("agent_events_tenant_run_ts_idx").on(t.tenantId, t.agentRunId, t.ts),
  ]
);

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const codeDiffs = pgTable(
  "code_diffs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    agentRunId: bigint("agent_run_id", { mode: "number" }).references(
      () => agentRuns.id,
      { onDelete: "set null" }
    ),
    repositoryId: bigint("repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.id),
    baseRef: text("base_ref").notNull(),
    headRef: text("head_ref").notNull(),
    unifiedDiff: text("unified_diff").notNull(),
    summary: text("summary"),
    statsJson: jsonb("stats_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("code_diffs_tenant_repo_created_idx").on(
      t.tenantId,
      t.repositoryId,
      t.createdAt
    ),
    index("code_diffs_tenant_run_idx").on(t.tenantId, t.agentRunId),
  ]
);
