import {
  pgTable,
  bigint,
  text,
  smallint,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { projects } from "./projects";
import { repositories } from "./connectors";

export const projectRepositories = pgTable(
  "project_repositories",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    repositoryId: bigint("repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.id),
    repoRole: smallint("repo_role").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("project_repos_tenant_project_repo_uniq").on(
      t.tenantId,
      t.projectId,
      t.repositoryId
    ),
    index("project_repos_tenant_project_role_idx").on(
      t.tenantId,
      t.projectId,
      t.repoRole
    ),
    index("project_repos_tenant_repo_idx").on(t.tenantId, t.repositoryId),
  ]
);

export const repositoryAliases = pgTable(
  "repository_aliases",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    repositoryId: bigint("repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
  },
  (t) => [
    uniqueIndex("repo_aliases_tenant_repo_alias_uniq").on(
      t.tenantId,
      t.repositoryId,
      t.alias
    ),
  ]
);
