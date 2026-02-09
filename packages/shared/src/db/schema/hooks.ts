import {
  pgTable,
  bigint,
  text,
  smallint,
  boolean,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

export const hooks = pgTable(
  "hooks",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    eventType: text("event_type").notNull(),
    runtime: smallint("runtime").notNull().default(1),
    code: text("code").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    timeoutMs: integer("timeout_ms").notNull().default(5000),
    createdBy: bigint("created_by", { mode: "number" }).references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("hooks_tenant_event_enabled_idx").on(t.tenantId, t.eventType, t.enabled),
  ]
);
