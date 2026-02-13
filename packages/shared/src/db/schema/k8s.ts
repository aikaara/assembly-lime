import {
  pgTable,
  bigint,
  text,
  smallint,
  boolean,
  integer,
  timestamp,
  jsonb,
  customType,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { repositories } from "./connectors";
import { previewDeployments } from "./preview-deployments";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const k8sClusters = pgTable(
  "k8s_clusters",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    apiUrl: text("api_url").notNull(),
    kubeconfigEnc: bytea("kubeconfig_enc"),
    authType: smallint("auth_type").notNull().default(1),
    status: text("status").notNull().default("pending"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    metadataJson: jsonb("metadata_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("k8s_clusters_tenant_name_uniq").on(t.tenantId, t.name),
    index("k8s_clusters_tenant_status_idx").on(t.tenantId, t.status),
  ]
);

export const sandboxes = pgTable(
  "sandboxes",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    clusterId: bigint("cluster_id", { mode: "number" }).references(() => k8sClusters.id),
    repositoryId: bigint("repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.id),
    branch: text("branch").notNull(),
    k8sNamespace: text("k8s_namespace").notNull(),
    k8sPod: text("k8s_pod").notNull(),
    k8sService: text("k8s_service"),
    k8sIngress: text("k8s_ingress"),
    sandboxUrl: text("sandbox_url"),
    status: text("status").notNull().default("creating"),
    portsJson: jsonb("ports_json").notNull().default([]),
    envVarSetId: bigint("env_var_set_id", { mode: "number" }),
    resourceLimitsJson: jsonb("resource_limits_json").notNull().default({}),
    createdBy: bigint("created_by", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    destroyedAt: timestamp("destroyed_at", { withTimezone: true }),
  },
  (t) => [
    index("sandboxes_tenant_repo_branch_idx").on(t.tenantId, t.repositoryId, t.branch),
    index("sandboxes_tenant_status_idx").on(t.tenantId, t.status),
    index("sandboxes_tenant_cluster_idx").on(t.tenantId, t.clusterId),
  ]
);

export const domains = pgTable(
  "domains",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    previewDeploymentId: bigint("preview_deployment_id", { mode: "number" }).references(
      () => previewDeployments.id,
      { onDelete: "set null" }
    ),
    sandboxId: bigint("sandbox_id", { mode: "number" }).references(() => sandboxes.id, {
      onDelete: "set null",
    }),
    domain: text("domain").notNull(),
    ingressName: text("ingress_name"),
    tlsCertSecret: text("tls_cert_secret"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("domains_tenant_domain_uniq").on(t.tenantId, t.domain),
    index("domains_tenant_status_idx").on(t.tenantId, t.status),
  ]
);
