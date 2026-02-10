import { eq, and } from "drizzle-orm";
import * as k8s from "@kubernetes/client-node";
import type { Db } from "@assembly-lime/shared/db";
import { k8sClusters } from "@assembly-lime/shared/db/schema";
import { encryptToken, decryptToken } from "../lib/encryption";
import { childLogger } from "../lib/logger";
import { provisionTenantNamespace, teardownTenantNamespace } from "./namespace-provisioner.service";

const log = childLogger({ module: "k8s-cluster-service" });

type RegisterClusterInput = {
  name: string;
  apiUrl: string;
  kubeconfig?: string;
  authType?: number;
  tenantSlug: string;
};

export function createClusterClient(kubeconfigYaml: string): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();
  kc.loadFromString(kubeconfigYaml);
  return kc;
}

export async function registerCluster(db: Db, tenantId: number, input: RegisterClusterInput) {
  let kubeconfigEnc: Buffer | undefined;
  if (input.kubeconfig) {
    kubeconfigEnc = encryptToken(input.kubeconfig);
  }

  const [row] = await db
    .insert(k8sClusters)
    .values({
      tenantId,
      name: input.name,
      apiUrl: input.apiUrl,
      kubeconfigEnc,
      authType: input.authType ?? 1,
      status: "pending",
    })
    .returning();

  // Test connectivity
  try {
    if (input.kubeconfig) {
      const kc = createClusterClient(input.kubeconfig);
      const coreApi = kc.makeApiClient(k8s.CoreV1Api);
      const versionApi = kc.makeApiClient(k8s.VersionApi);
      const version = await versionApi.getCode();
      const nodes = await coreApi.listNode();

      await db
        .update(k8sClusters)
        .set({
          status: "connected",
          lastSyncedAt: new Date(),
          metadataJson: {
            gitVersion: version.gitVersion,
            nodeCount: nodes.items.length,
          },
        })
        .where(eq(k8sClusters.id, row!.id));

      log.info({ clusterId: row!.id, tenantId }, "cluster registered and connected");

      // Provision tenant namespace on the cluster
      try {
        await provisionTenantNamespace(db, tenantId, input.tenantSlug, row!.id);
      } catch (nsErr) {
        log.error({ err: nsErr, clusterId: row!.id }, "failed to provision tenant namespace");
      }
    }
  } catch (err) {
    await db
      .update(k8sClusters)
      .set({ status: "error" })
      .where(eq(k8sClusters.id, row!.id));
    log.error({ err, clusterId: row!.id }, "cluster connectivity test failed");
  }

  return row!;
}

export async function listClusters(db: Db, tenantId: number) {
  return db
    .select()
    .from(k8sClusters)
    .where(eq(k8sClusters.tenantId, tenantId));
}

export async function syncCluster(db: Db, tenantId: number, clusterId: number) {
  const [cluster] = await db
    .select()
    .from(k8sClusters)
    .where(and(eq(k8sClusters.id, clusterId), eq(k8sClusters.tenantId, tenantId)));
  if (!cluster) return null;

  if (!cluster.kubeconfigEnc) {
    return { ...cluster, error: "No kubeconfig stored" };
  }

  try {
    const kubeconfigYaml = decryptToken(cluster.kubeconfigEnc);
    const kc = createClusterClient(kubeconfigYaml);
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);
    const versionApi = kc.makeApiClient(k8s.VersionApi);
    const version = await versionApi.getCode();
    const nodes = await coreApi.listNode();

    const [updated] = await db
      .update(k8sClusters)
      .set({
        status: "connected",
        lastSyncedAt: new Date(),
        metadataJson: {
          gitVersion: version.gitVersion,
          nodeCount: nodes.items.length,
        },
      })
      .where(eq(k8sClusters.id, clusterId))
      .returning();

    log.info({ clusterId, tenantId }, "cluster synced");
    return updated;
  } catch (err) {
    await db
      .update(k8sClusters)
      .set({ status: "error" })
      .where(eq(k8sClusters.id, clusterId));
    log.error({ err, clusterId }, "cluster sync failed");
    throw err;
  }
}

export async function getClusterClient(
  db: Db,
  tenantId: number,
  clusterId: number
): Promise<k8s.KubeConfig> {
  const [cluster] = await db
    .select()
    .from(k8sClusters)
    .where(and(eq(k8sClusters.id, clusterId), eq(k8sClusters.tenantId, tenantId)));
  if (!cluster) throw new Error("Cluster not found");
  if (!cluster.kubeconfigEnc) throw new Error("No kubeconfig stored for cluster");

  const yaml = decryptToken(cluster.kubeconfigEnc);
  return createClusterClient(yaml);
}

export async function deleteCluster(db: Db, tenantId: number, clusterId: number, tenantSlug: string) {
  // Tear down tenant namespace before deleting DB row
  try {
    await teardownTenantNamespace(db, tenantId, tenantSlug, clusterId);
  } catch (err) {
    log.warn({ err, clusterId, tenantId }, "failed to teardown tenant namespace (proceeding with deletion)");
  }

  const [row] = await db
    .delete(k8sClusters)
    .where(and(eq(k8sClusters.id, clusterId), eq(k8sClusters.tenantId, tenantId)))
    .returning();
  if (row) log.info({ clusterId, tenantId }, "cluster deleted");
  return row ?? null;
}
