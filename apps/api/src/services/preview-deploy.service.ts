import { eq, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { previewDeployments, repositories } from "@assembly-lime/shared/db/schema";
import type { PreviewDeploymentStatus } from "@assembly-lime/shared";
import {
  appsApi,
  coreApi,
  networkingApi,
  K8S_NAMESPACE,
  PREVIEW_DOMAIN,
  PREVIEW_INGRESS_CLASS,
} from "../lib/k8s";
import { logger } from "../lib/logger";
import type * as k8s from "@kubernetes/client-node";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 53);
}

type CreatePreviewInput = {
  tenantId: number;
  agentRunId?: number;
  repositoryId: number;
  branch: string;
  featureSlug?: string;
  appImage: string;
};

export async function createPreviewDeployment(db: Db, input: CreatePreviewInput) {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, input.repositoryId));
  if (!repo) throw new Error("Repository not found");

  const feature = input.featureSlug ?? "preview";
  const branchSlug = slugify(input.branch);
  const name = slugify(`preview-${feature}-${branchSlug}`);
  const host = `${slugify(feature)}-${branchSlug}.${repo.name}.${PREVIEW_DOMAIN}`;
  const ns = K8S_NAMESPACE;

  // Create K8s Deployment
  const deployment: k8s.V1Deployment = {
    metadata: { name, namespace: ns, labels: { "assembly-lime/preview": name } },
    spec: {
      replicas: 1,
      selector: { matchLabels: { "assembly-lime/preview": name } },
      template: {
        metadata: { labels: { "assembly-lime/preview": name } },
        spec: {
          containers: [
            {
              name: "app",
              image: input.appImage,
              ports: [{ containerPort: 3000 }],
              resources: {
                requests: { cpu: "100m", memory: "128Mi" },
                limits: { cpu: "500m", memory: "512Mi" },
              },
            },
          ],
        },
      },
    },
  };

  // Create K8s Service
  const service: k8s.V1Service = {
    metadata: { name, namespace: ns },
    spec: {
      selector: { "assembly-lime/preview": name },
      ports: [{ port: 80, targetPort: 3000 }],
    },
  };

  // Create K8s Ingress
  const ingress: k8s.V1Ingress = {
    metadata: {
      name,
      namespace: ns,
      annotations: { "nginx.ingress.kubernetes.io/proxy-body-size": "50m" },
    },
    spec: {
      ingressClassName: PREVIEW_INGRESS_CLASS,
      rules: [
        {
          host,
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  service: { name, port: { number: 80 } },
                },
              },
            ],
          },
        },
      ],
    },
  };

  try {
    await appsApi.createNamespacedDeployment({ namespace: ns, body: deployment });
    await coreApi.createNamespacedService({ namespace: ns, body: service });
    await networkingApi.createNamespacedIngress({ namespace: ns, body: ingress });
  } catch (err) {
    logger.error({ err, name }, "failed to create K8s preview resources");
    throw err;
  }

  const previewUrl = `https://${host}`;

  const [row] = await db
    .insert(previewDeployments)
    .values({
      tenantId: input.tenantId,
      agentRunId: input.agentRunId,
      repositoryId: input.repositoryId,
      branch: input.branch,
      featureSlug: feature,
      previewUrl,
      k8sNamespace: ns,
      k8sDeployment: name,
      k8sService: name,
      k8sIngress: name,
      status: "active",
    })
    .returning();

  logger.info({ previewId: row!.id, previewUrl }, "preview deployment created");
  return row!;
}

export async function destroyPreviewDeployment(
  db: Db,
  tenantId: number,
  previewId: number
) {
  const [row] = await db
    .select()
    .from(previewDeployments)
    .where(
      and(
        eq(previewDeployments.id, previewId),
        eq(previewDeployments.tenantId, tenantId)
      )
    );
  if (!row) return null;

  const ns = row.k8sNamespace ?? K8S_NAMESPACE;

  try {
    if (row.k8sIngress) {
      await networkingApi.deleteNamespacedIngress({ namespace: ns, name: row.k8sIngress });
    }
    if (row.k8sService) {
      await coreApi.deleteNamespacedService({ namespace: ns, name: row.k8sService });
    }
    if (row.k8sDeployment) {
      await appsApi.deleteNamespacedDeployment({ namespace: ns, name: row.k8sDeployment });
    }
  } catch (err) {
    logger.error({ err, previewId }, "failed to destroy K8s preview resources");
  }

  await db
    .update(previewDeployments)
    .set({
      status: "destroyed" satisfies PreviewDeploymentStatus,
      destroyedAt: new Date(),
    })
    .where(eq(previewDeployments.id, previewId));

  return { ...row, status: "destroyed" as const };
}

export async function listPreviewDeployments(db: Db, tenantId: number) {
  return db
    .select()
    .from(previewDeployments)
    .where(eq(previewDeployments.tenantId, tenantId));
}
