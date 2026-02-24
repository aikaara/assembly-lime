import {
  pgTable,
  bigint,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { repositories } from "./connectors";

export const sandboxCache = pgTable(
  "sandbox_cache",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    repositoryId: bigint("repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    sandboxId: text("sandbox_id").notNull(),
    repoDir: text("repo_dir").notNull(),
    defaultBranch: text("default_branch").notNull(),
    status: text("status").notNull().default("available"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sandbox_cache_tenant_repo_status_idx").on(t.tenantId, t.repositoryId, t.status),
    index("sandbox_cache_tenant_status_idx").on(t.tenantId, t.status),
  ]
);
