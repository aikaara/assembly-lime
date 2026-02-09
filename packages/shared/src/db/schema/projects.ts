import {
  pgTable,
  bigint,
  text,
  smallint,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

export const projects = pgTable(
  "projects",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("projects_tenant_key_uniq").on(t.tenantId, t.key),
    index("projects_tenant_created_idx").on(t.tenantId, t.createdAt),
  ]
);

export const boards = pgTable(
  "boards",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    columnsJson: jsonb("columns_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("boards_tenant_project_name_uniq").on(t.tenantId, t.projectId, t.name),
    index("boards_tenant_project_idx").on(t.tenantId, t.projectId),
  ]
);

export const tickets = pgTable(
  "tickets",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    boardId: bigint("board_id", { mode: "number" })
      .notNull()
      .references(() => boards.id),
    columnKey: text("column_key").notNull(),
    title: text("title").notNull(),
    descriptionMd: text("description_md"),
    priority: smallint("priority").default(2),
    labelsJson: jsonb("labels_json").notNull().default([]),
    assigneeUserId: bigint("assignee_user_id", { mode: "number" }).references(
      () => users.id
    ),
    repositoryId: bigint("repository_id", { mode: "number" }),
    branch: text("branch"),
    prUrl: text("pr_url"),
    statusMetaJson: jsonb("status_meta_json").notNull().default({}),
    createdBy: bigint("created_by", { mode: "number" }).references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tickets_tenant_project_col_idx").on(t.tenantId, t.projectId, t.columnKey),
    index("tickets_tenant_assignee_idx").on(t.tenantId, t.assigneeUserId),
    index("tickets_tenant_repo_idx").on(t.tenantId, t.repositoryId),
    index("tickets_tenant_updated_idx").on(t.tenantId, t.updatedAt),
  ]
);
