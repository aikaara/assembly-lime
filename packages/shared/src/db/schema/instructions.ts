import {
  pgTable,
  bigint,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const customInstructions = pgTable(
  "custom_instructions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    scopeType: text("scope_type").notNull(),
    scopeId: bigint("scope_id", { mode: "number" }).notNull(),
    mode: text("mode").notNull(),
    contentMd: text("content_md").notNull(),
    priority: integer("priority").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("custom_instr_tenant_scope_mode_priority_uniq").on(
      t.tenantId,
      t.scopeType,
      t.scopeId,
      t.mode,
      t.priority
    ),
    index("custom_instr_tenant_scope_enabled_idx").on(
      t.tenantId,
      t.scopeType,
      t.scopeId,
      t.enabled
    ),
    index("custom_instr_tenant_mode_idx").on(t.tenantId, t.mode),
  ]
);

export const defaultAgentInstructions = pgTable(
  "default_agent_instructions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    provider: text("provider").notNull(),
    contentMd: text("content_md").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("default_agent_instr_tenant_provider_uniq").on(t.tenantId, t.provider),
    index("default_agent_instr_tenant_enabled_idx").on(t.tenantId, t.enabled),
  ]
);

export const defaultAgentTools = pgTable(
  "default_agent_tools",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    provider: text("provider").notNull(),
    allowedToolsJson: jsonb("allowed_tools_json").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("default_agent_tools_tenant_provider_uniq").on(t.tenantId, t.provider),
    index("default_agent_tools_tenant_enabled_idx").on(t.tenantId, t.enabled),
  ]
);
