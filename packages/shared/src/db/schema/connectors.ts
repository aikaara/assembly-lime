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

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const connectors = pgTable(
  "connectors",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    provider: smallint("provider").notNull(),
    externalOrg: text("external_org"),
    authType: smallint("auth_type").notNull(),
    accessTokenEnc: bytea("access_token_enc").notNull(),
    refreshTokenEnc: bytea("refresh_token_enc"),
    scopesJson: jsonb("scopes_json").notNull().default([]),
    status: smallint("status").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("connectors_tenant_provider_status_idx").on(t.tenantId, t.provider, t.status),
    index("connectors_tenant_created_idx").on(t.tenantId, t.createdAt),
  ]
);

export const repositories = pgTable(
  "repositories",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    connectorId: bigint("connector_id", { mode: "number" })
      .notNull()
      .references(() => connectors.id),
    provider: smallint("provider").notNull(),
    externalRepoId: bigint("external_repo_id", { mode: "number" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    cloneUrl: text("clone_url").notNull(),
    defaultBranch: text("default_branch").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("repos_tenant_provider_fullname_uniq").on(
      t.tenantId,
      t.provider,
      t.fullName
    ),
    index("repos_tenant_connector_idx").on(t.tenantId, t.connectorId),
    index("repos_tenant_enabled_idx").on(t.tenantId, t.isEnabled),
    index("repos_tenant_external_idx").on(t.tenantId, t.externalRepoId),
  ]
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    connectorId: bigint("connector_id", { mode: "number" })
      .notNull()
      .references(() => connectors.id),
    provider: smallint("provider").notNull(),
    externalWebhookId: bigint("external_webhook_id", { mode: "number" }),
    secretEnc: bytea("secret_enc").notNull(),
    eventsJson: jsonb("events_json").notNull().default([]),
    targetPath: text("target_path").notNull(),
    status: smallint("status").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhooks_tenant_connector_status_idx").on(
      t.tenantId,
      t.connectorId,
      t.status
    ),
  ]
);
