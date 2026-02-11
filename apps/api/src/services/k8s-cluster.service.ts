import { eq, and } from "drizzle-orm";
import { readFileSync } from "fs";
import * as k8s from "@kubernetes/client-node";
import type { Db } from "@assembly-lime/shared/db";
import { k8sClusters } from "@assembly-lime/shared/db/schema";
import { encryptToken, decryptToken } from "../lib/encryption";
import { childLogger } from "../lib/logger";
import { provisionTenantNamespace, teardownTenantNamespace } from "./namespace-provisioner.service";

const log = childLogger({ module: "k8s-cluster-service" });

// ---------------------------------------------------------------------------
// Bun TLS fix for @kubernetes/client-node
//
// Problem chain:
//   1. The k8s library sets the CA cert via `new https.Agent({ ca })`
//   2. It passes that agent to `node-fetch` v2
//   3. node-fetch calls `https.request()` with the agent
//   4. On Bun, `https.Agent` is a no-op stub → CA cert is silently lost
//   5. TLS handshake fails: "unable to verify the first certificate"
//
// Fix: Patch `IsomorphicFetchHttpLibrary.prototype.send` (the k8s library's
// HTTP transport) to use Bun's native `globalThis.fetch` with the `tls`
// option for known K8s cluster URLs. Bun's fetch honors `tls: { ca }`.
// Built-in modules like `https` are frozen in Bun (readonly), but class
// prototypes from npm packages are mutable, so this works.
// ---------------------------------------------------------------------------
const clusterCaMap = new Map<string, string>(); // server URL prefix → PEM

// Grab the HTTP library class + ResponseContext from the k8s client internals
const {
  IsomorphicFetchHttpLibrary,
// eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("@kubernetes/client-node/dist/gen/http/isomorphic-fetch.js") as {
  IsomorphicFetchHttpLibrary: { prototype: { send: (req: any) => any } };
};
const {
  ResponseContext,
// eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("@kubernetes/client-node/dist/gen/http/http.js") as {
  ResponseContext: new (status: number, headers: Record<string, string>, body: any) => any;
};
const {
  from: rxFrom,
// eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("@kubernetes/client-node/dist/gen/rxjsStub.js") as {
  from: (p: Promise<any>) => any;
};

const _originalSend = IsomorphicFetchHttpLibrary.prototype.send;
IsomorphicFetchHttpLibrary.prototype.send = function patchedSend(request: any) {
  const url: string = request.getUrl();

  // Check if the request targets a registered K8s cluster
  for (const [server, ca] of clusterCaMap) {
    if (url.startsWith(server)) {
      // Use Bun's native fetch with explicit TLS CA
      const resultPromise = globalThis
        .fetch(url, {
          method: request.getHttpMethod().toString(),
          body: request.getBody() ?? undefined,
          headers: request.getHeaders(),
          signal: request.getSignal(),
          // @ts-expect-error — Bun-specific TLS option
          tls: { ca },
        } as RequestInit)
        .then(async (resp) => {
          const headers: Record<string, string> = {};
          resp.headers.forEach((value, name) => {
            headers[name] = value;
          });
          const body = {
            text: () => resp.text(),
            binary: () => resp.arrayBuffer().then((ab) => Buffer.from(ab)),
          };
          return new ResponseContext(resp.status, headers, body);
        });

      return rxFrom(resultPromise);
    }
  }

  // Not a cluster URL — use the original node-fetch path
  return _originalSend.call(this, request);
};

/** Register cluster CA so our patched send trusts the server cert. */
function registerClusterTls(kc: k8s.KubeConfig): void {
  const cluster = kc.getCurrentCluster() ?? kc.clusters[0];
  if (!cluster?.server) return;

  let ca: string | undefined;
  if (cluster.caData) {
    ca = Buffer.from(cluster.caData, "base64").toString("utf8");
  } else if (cluster.caFile) {
    ca = readFileSync(cluster.caFile, "utf8");
  }

  if (ca) clusterCaMap.set(cluster.server, ca);
}

/** Remove cluster CA entry when a cluster is deleted. */
function unregisterClusterTls(kc: k8s.KubeConfig): void {
  const cluster = kc.getCurrentCluster() ?? kc.clusters[0];
  if (cluster?.server) clusterCaMap.delete(cluster.server);
}

type RegisterClusterInput = {
  name: string;
  apiUrl?: string;
  kubeconfig?: string;
  authType?: number;
  tenantSlug: string;
};

/** Extract the first cluster server URL from a kubeconfig YAML string. */
function extractServerUrl(kubeconfigYaml: string): string | undefined {
  const kc = new k8s.KubeConfig();
  kc.loadFromString(kubeconfigYaml);
  const cluster = kc.getCurrentCluster();
  return cluster?.server ?? kc.clusters[0]?.server;
}

export function createClusterClient(kubeconfigYaml: string): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();
  kc.loadFromString(kubeconfigYaml);
  registerClusterTls(kc);
  return kc;
}

export async function registerCluster(db: Db, tenantId: number, input: RegisterClusterInput) {
  // Resolve API URL: explicit value takes priority, otherwise extract from kubeconfig
  let apiUrl = input.apiUrl;
  if (!apiUrl && input.kubeconfig) {
    apiUrl = extractServerUrl(input.kubeconfig);
  }
  if (!apiUrl) {
    throw new Error("API URL is required when no kubeconfig is provided");
  }

  let kubeconfigEnc: Buffer | undefined;
  if (input.kubeconfig) {
    kubeconfigEnc = encryptToken(input.kubeconfig);
  }

  const [row] = await db
    .insert(k8sClusters)
    .values({
      tenantId,
      name: input.name,
      apiUrl,
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
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db
      .update(k8sClusters)
      .set({
        status: "error",
        metadataJson: { error: errorMessage },
      })
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
    const errorMessage = err instanceof Error ? err.message : String(err);
    const [updated] = await db
      .update(k8sClusters)
      .set({
        status: "error",
        metadataJson: { error: errorMessage },
      })
      .where(eq(k8sClusters.id, clusterId))
      .returning();
    log.error({ err, clusterId }, "cluster sync failed");
    return updated;
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
  // Clean up TLS entry if kubeconfig was stored
  try {
    const kc = await getClusterClient(db, tenantId, clusterId);
    unregisterClusterTls(kc);
  } catch {
    // No kubeconfig stored — nothing to clean up
  }

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
