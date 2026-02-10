import * as k8s from "@kubernetes/client-node";
import type { Db } from "@assembly-lime/shared/db";
import { getClusterClient } from "./k8s-cluster.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "namespace-provisioner" });

const DEFAULT_QUOTA = {
  cpu: "8",
  memory: "16Gi",
  pods: "20",
};

export function tenantNamespace(tenantSlug: string): string {
  return `al-${tenantSlug}`;
}

export async function provisionTenantNamespace(
  db: Db,
  tenantId: number,
  tenantSlug: string,
  clusterId: number,
  config?: { cpu?: string; memory?: string; pods?: string }
): Promise<void> {
  const kc = await getClusterClient(db, tenantId, clusterId);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const rbacApi = kc.makeApiClient(k8s.RbacAuthorizationV1Api);
  const ns = tenantNamespace(tenantSlug);
  const quota = { ...DEFAULT_QUOTA, ...config };

  // 1. Create namespace (idempotent)
  try {
    await coreApi.readNamespace({ name: ns });
    log.info({ ns }, "namespace already exists");
  } catch {
    await coreApi.createNamespace({
      body: {
        metadata: {
          name: ns,
          labels: {
            "app.kubernetes.io/part-of": "assembly-lime",
            "app.kubernetes.io/managed-by": "assembly-lime",
            "assembly-lime/tenant-id": String(tenantId),
          },
        },
      },
    });
    log.info({ ns, tenantId }, "namespace created");
  }

  // 2. ServiceAccount (idempotent)
  try {
    await coreApi.readNamespacedServiceAccount({ namespace: ns, name: "al-agent-sa" });
  } catch {
    await coreApi.createNamespacedServiceAccount({
      namespace: ns,
      body: {
        metadata: {
          name: "al-agent-sa",
          namespace: ns,
          labels: { "app.kubernetes.io/part-of": "assembly-lime" },
        },
      },
    });
    log.info({ ns }, "service account al-agent-sa created");
  }

  // 3. Role (idempotent)
  const roleName = "al-agent-role";
  const roleBody: k8s.V1Role = {
    metadata: {
      name: roleName,
      namespace: ns,
      labels: { "app.kubernetes.io/part-of": "assembly-lime" },
    },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods", "pods/log"],
        verbs: ["get", "list", "watch"],
      },
      {
        apiGroups: ["batch"],
        resources: ["jobs"],
        verbs: ["create", "get", "list", "watch", "delete"],
      },
      {
        apiGroups: [""],
        resources: ["secrets"],
        verbs: ["get", "list"],
      },
    ],
  };

  try {
    await rbacApi.readNamespacedRole({ namespace: ns, name: roleName });
    await rbacApi.replaceNamespacedRole({ namespace: ns, name: roleName, body: roleBody });
  } catch {
    await rbacApi.createNamespacedRole({ namespace: ns, body: roleBody });
    log.info({ ns }, "role al-agent-role created");
  }

  // 4. RoleBinding (idempotent)
  const bindingName = "al-agent-binding";
  const bindingBody: k8s.V1RoleBinding = {
    metadata: {
      name: bindingName,
      namespace: ns,
      labels: { "app.kubernetes.io/part-of": "assembly-lime" },
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: "al-agent-sa",
        namespace: ns,
      },
    ],
    roleRef: {
      kind: "Role",
      name: roleName,
      apiGroup: "rbac.authorization.k8s.io",
    },
  };

  try {
    await rbacApi.readNamespacedRoleBinding({ namespace: ns, name: bindingName });
    await rbacApi.replaceNamespacedRoleBinding({ namespace: ns, name: bindingName, body: bindingBody });
  } catch {
    await rbacApi.createNamespacedRoleBinding({ namespace: ns, body: bindingBody });
    log.info({ ns }, "role binding al-agent-binding created");
  }

  // 5. ResourceQuota (idempotent)
  const quotaName = "al-agent-quota";
  const quotaBody: k8s.V1ResourceQuota = {
    metadata: {
      name: quotaName,
      namespace: ns,
      labels: { "app.kubernetes.io/part-of": "assembly-lime" },
    },
    spec: {
      hard: {
        "requests.cpu": quota.cpu,
        "requests.memory": quota.memory,
        pods: quota.pods,
      },
    },
  };

  try {
    await coreApi.readNamespacedResourceQuota({ namespace: ns, name: quotaName });
    await coreApi.replaceNamespacedResourceQuota({ namespace: ns, name: quotaName, body: quotaBody });
  } catch {
    await coreApi.createNamespacedResourceQuota({ namespace: ns, body: quotaBody });
    log.info({ ns }, "resource quota created");
  }

  log.info({ ns, tenantId, clusterId }, "tenant namespace provisioned");
}

export async function ensureGitCredentialSecret(
  kc: k8s.KubeConfig,
  namespace: string,
  secretName: string,
  token: string
): Promise<void> {
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const tokenBase64 = Buffer.from(token).toString("base64");

  const secretBody: k8s.V1Secret = {
    metadata: {
      name: secretName,
      namespace,
      labels: {
        "app.kubernetes.io/part-of": "assembly-lime",
        "app.kubernetes.io/component": "git-credentials",
      },
    },
    type: "Opaque",
    data: {
      token: tokenBase64,
    },
  };

  try {
    await coreApi.readNamespacedSecret({ namespace, name: secretName });
    // Secret exists — replace it
    await coreApi.replaceNamespacedSecret({ namespace, name: secretName, body: secretBody });
    log.info({ namespace, secretName }, "git credential secret updated");
  } catch {
    // 404 — create
    await coreApi.createNamespacedSecret({ namespace, body: secretBody });
    log.info({ namespace, secretName }, "git credential secret created");
  }
}

export async function deleteGitCredentialSecret(
  kc: k8s.KubeConfig,
  namespace: string,
  secretName: string
): Promise<void> {
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  try {
    await coreApi.deleteNamespacedSecret({ namespace, name: secretName });
    log.info({ namespace, secretName }, "git credential secret deleted");
  } catch {
    // Already gone — fine
  }
}

export async function teardownTenantNamespace(
  db: Db,
  tenantId: number,
  tenantSlug: string,
  clusterId: number
): Promise<void> {
  const kc = await getClusterClient(db, tenantId, clusterId);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const ns = tenantNamespace(tenantSlug);

  try {
    await coreApi.deleteNamespace({ name: ns });
    log.info({ ns, tenantId, clusterId }, "tenant namespace deleted (cascading all resources)");
  } catch (err) {
    log.warn({ err, ns }, "failed to delete tenant namespace (may already be gone)");
  }
}
