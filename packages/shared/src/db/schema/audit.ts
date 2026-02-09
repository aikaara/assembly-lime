import {
  pgTable,
  bigint,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    actorUserId: bigint("actor_user_id", { mode: "number" }).references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: bigint("target_id", { mode: "number" }).notNull(),
    payloadJson: jsonb("payload_json").notNull().default({}),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_tenant_ts_idx").on(t.tenantId, t.ts),
    index("audit_log_tenant_actor_ts_idx").on(t.tenantId, t.actorUserId, t.ts),
  ]
);
