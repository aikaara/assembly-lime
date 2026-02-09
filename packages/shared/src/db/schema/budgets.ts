import {
  pgTable,
  bigint,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { projects } from "./projects";

export const projectBudgets = pgTable(
  "project_budgets",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    limitCents: bigint("limit_cents", { mode: "number" }).notNull(),
    softLimitCents: bigint("soft_limit_cents", { mode: "number" }),
    currency: text("currency").notNull().default("USD"),
    enforceHardStop: boolean("enforce_hard_stop").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("project_budgets_tenant_project_period_uniq").on(
      t.tenantId,
      t.projectId,
      t.period
    ),
    index("project_budgets_tenant_project_idx").on(t.tenantId, t.projectId),
  ]
);
