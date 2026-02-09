import {
  pgTable,
  bigint,
  text,
  smallint,
  boolean,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { projects, tickets } from "./projects";
import { repositories } from "./connectors";
import { users } from "./users";

export const buildPipelines = pgTable(
  "build_pipelines",
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
    provider: smallint("provider").notNull(),
    name: text("name").notNull(),
    configJson: jsonb("config_json").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    pipelineRepositoryId: bigint("pipeline_repository_id", { mode: "number" }).references(
      () => repositories.id
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("build_pipelines_tenant_project_name_uniq").on(
      t.tenantId,
      t.projectId,
      t.name
    ),
    index("build_pipelines_tenant_project_idx").on(t.tenantId, t.projectId),
    index("build_pipelines_tenant_repo_idx").on(t.tenantId, t.repositoryId),
    index("build_pipelines_tenant_enabled_idx").on(t.tenantId, t.enabled),
    index("build_pipelines_tenant_pipeline_repo_idx").on(
      t.tenantId,
      t.pipelineRepositoryId
    ),
  ]
);

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    pipelineId: bigint("pipeline_id", { mode: "number" })
      .notNull()
      .references(() => buildPipelines.id, { onDelete: "cascade" }),
    externalRunId: bigint("external_run_id", { mode: "number" }),
    status: text("status").notNull(),
    conclusion: text("conclusion"),
    url: text("url"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("pipeline_runs_tenant_pipeline_started_idx").on(
      t.tenantId,
      t.pipelineId,
      t.startedAt
    ),
    index("pipeline_runs_tenant_status_idx").on(t.tenantId, t.status),
  ]
);

export const deploymentTargets = pgTable(
  "deployment_targets",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    configJson: jsonb("config_json").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("deploy_targets_tenant_project_name_uniq").on(
      t.tenantId,
      t.projectId,
      t.name
    ),
    index("deploy_targets_tenant_project_idx").on(t.tenantId, t.projectId),
    index("deploy_targets_tenant_enabled_idx").on(t.tenantId, t.enabled),
  ]
);

export const deployments = pgTable(
  "deployments",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ticketId: bigint("ticket_id", { mode: "number" }).references(() => tickets.id),
    deploymentTargetId: bigint("deployment_target_id", { mode: "number" })
      .notNull()
      .references(() => deploymentTargets.id),
    status: smallint("status").notNull().default(1),
    createdBy: bigint("created_by", { mode: "number" }).references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("deployments_tenant_project_created_idx").on(
      t.tenantId,
      t.projectId,
      t.createdAt
    ),
    index("deployments_tenant_target_status_idx").on(
      t.tenantId,
      t.deploymentTargetId,
      t.status
    ),
  ]
);

export const deploymentSteps = pgTable(
  "deployment_steps",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    deploymentId: bigint("deployment_id", { mode: "number" })
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull(),
    kind: smallint("kind").notNull(),
    pipelineId: bigint("pipeline_id", { mode: "number" }).references(
      () => buildPipelines.id
    ),
    repositoryId: bigint("repository_id", { mode: "number" }).references(
      () => repositories.id
    ),
    configJson: jsonb("config_json").notNull().default({}),
    status: smallint("status").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("deploy_steps_tenant_deploy_order_uniq").on(
      t.tenantId,
      t.deploymentId,
      t.stepOrder
    ),
    index("deploy_steps_tenant_deploy_order_idx").on(
      t.tenantId,
      t.deploymentId,
      t.stepOrder
    ),
  ]
);
