import {
  pgTable,
  bigint,
  text,
  smallint,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { repositories } from "./connectors";

export const repositoryDependencies = pgTable(
  "repository_dependencies",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    sourceRepositoryId: bigint("source_repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    targetRepositoryId: bigint("target_repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    dependencyType: text("dependency_type").notNull(), // "package" | "api_consumer" | "sdk_usage" | "docker_ref" | "submodule" | "shared_config"
    confidence: smallint("confidence").notNull().default(50), // 0-100
    detectedFrom: text("detected_from"), // file path where dependency was detected
    metadata: jsonb("metadata").default({}), // { packageName, version, notes }
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("repo_deps_tenant_src_tgt_type_uniq").on(
      t.tenantId,
      t.sourceRepositoryId,
      t.targetRepositoryId,
      t.dependencyType
    ),
    index("repo_deps_tenant_source_idx").on(t.tenantId, t.sourceRepositoryId),
    index("repo_deps_tenant_target_idx").on(t.tenantId, t.targetRepositoryId),
  ]
);

export const dependencyScans = pgTable(
  "dependency_scans",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    status: text("status").notNull().default("pending"), // "pending" | "running" | "completed" | "failed"
    reposScanned: integer("repos_scanned").notNull().default(0),
    depsFound: integer("deps_found").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dep_scans_tenant_status_idx").on(t.tenantId, t.status),
  ]
);
