import {
  pgTable,
  bigint,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { agentRuns } from "./agents";
import { repositories } from "./connectors";

export const previewDeployments = pgTable(
  "preview_deployments",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    agentRunId: bigint("agent_run_id", { mode: "number" }).references(
      () => agentRuns.id,
      { onDelete: "set null" }
    ),
    repositoryId: bigint("repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.id),
    branch: text("branch").notNull(),
    featureSlug: text("feature_slug"),
    previewUrl: text("preview_url"),
    k8sNamespace: text("k8s_namespace"),
    k8sDeployment: text("k8s_deployment"),
    k8sService: text("k8s_service"),
    k8sIngress: text("k8s_ingress"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    destroyedAt: timestamp("destroyed_at", { withTimezone: true }),
  },
  (t) => [
    index("preview_deploy_tenant_repo_branch_idx").on(t.tenantId, t.repositoryId, t.branch),
    index("preview_deploy_tenant_status_idx").on(t.tenantId, t.status),
    index("preview_deploy_tenant_run_idx").on(t.tenantId, t.agentRunId),
  ]
);
