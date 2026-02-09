import {
  pgTable,
  bigint,
  text,
  smallint,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { projects } from "./projects";
import { repositories } from "./connectors";

export const features = pgTable(
  "features",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    ownerTeam: text("owner_team"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // search_text is a GENERATED column — added via custom migration SQL
  },
  (t) => [
    uniqueIndex("features_tenant_project_key_uniq").on(t.tenantId, t.projectId, t.key),
  ]
);

export const featureRepositoryMap = pgTable(
  "feature_repository_map",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    featureId: bigint("feature_id", { mode: "number" })
      .notNull()
      .references(() => features.id, { onDelete: "cascade" }),
    repositoryId: bigint("repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.id),
    changeType: smallint("change_type").notNull(),
    priority: smallint("priority").notNull().default(2),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("feat_repo_map_tenant_feat_repo_uniq").on(
      t.tenantId,
      t.featureId,
      t.repositoryId
    ),
    index("feat_repo_map_tenant_feat_priority_idx").on(
      t.tenantId,
      t.featureId,
      t.priority
    ),
    index("feat_repo_map_tenant_repo_idx").on(t.tenantId, t.repositoryId),
  ]
);

export const featureAliases = pgTable(
  "feature_aliases",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    featureId: bigint("feature_id", { mode: "number" })
      .notNull()
      .references(() => features.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
  },
  (t) => [
    uniqueIndex("feat_aliases_tenant_feat_alias_uniq").on(
      t.tenantId,
      t.featureId,
      t.alias
    ),
  ]
);
