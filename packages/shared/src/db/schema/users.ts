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

export const roles = pgTable(
  "roles",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    permissionsJson: jsonb("permissions_json").notNull().default({}),
  },
  (t) => [
    uniqueIndex("roles_tenant_name_uniq").on(t.tenantId, t.name),
  ]
);

export const users = pgTable(
  "users",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    email: text("email").notNull(), // citext handled via migration SQL
    name: text("name"),
    avatarUrl: text("avatar_url"),
    githubLogin: text("github_login"),
    githubUserId: bigint("github_user_id", { mode: "number" }),
    status: smallint("status").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_tenant_email_uniq").on(t.tenantId, t.email),
    uniqueIndex("users_github_user_id_uniq").on(t.githubUserId),
    index("users_tenant_status_idx").on(t.tenantId, t.status),
    index("users_tenant_github_idx").on(t.tenantId, t.githubUserId),
  ]
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: bigint("role_id", { mode: "number" })
      .notNull()
      .references(() => roles.id),
  },
  (t) => [
    uniqueIndex("user_roles_tenant_user_role_uniq").on(t.tenantId, t.userId, t.roleId),
    index("user_roles_tenant_user_idx").on(t.tenantId, t.userId),
  ]
);
