import {
  pgTable,
  bigint,
  text,
  smallint,
  boolean,
  timestamp,
  jsonb,
  customType,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    userId: bigint("user_id", { mode: "number" }).references(() => users.id),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: bytea("key_hash").notNull(),
    scopesJson: jsonb("scopes_json").notNull().default([]),
    status: smallint("status").notNull().default(1),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("api_keys_tenant_status_idx").on(t.tenantId, t.status),
    uniqueIndex("api_keys_tenant_prefix_uniq").on(t.tenantId, t.prefix),
  ]
);

export const envVarSets = pgTable(
  "env_var_sets",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    scopeType: text("scope_type").notNull(),
    scopeId: bigint("scope_id", { mode: "number" }).notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("env_var_sets_tenant_scope_name_uniq").on(
      t.tenantId,
      t.scopeType,
      t.scopeId,
      t.name
    ),
    index("env_var_sets_tenant_scope_idx").on(t.tenantId, t.scopeType, t.scopeId),
  ]
);

export const envVars = pgTable(
  "env_vars",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    setId: bigint("set_id", { mode: "number" })
      .notNull()
      .references(() => envVarSets.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    valueEnc: bytea("value_enc").notNull(),
    isSecret: boolean("is_secret").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("env_vars_tenant_set_key_uniq").on(t.tenantId, t.setId, t.key),
    index("env_vars_tenant_set_idx").on(t.tenantId, t.setId),
  ]
);
