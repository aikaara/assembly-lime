import * as k8s from "@kubernetes/client-node";
import type { AgentJobPayload } from "@assembly-lime/shared";
import { logger } from "../lib/logger";

const K8S_NAMESPACE = process.env.K8S_NAMESPACE ?? "assembly-lime";
const K8S_AGENT_IMAGE =
  process.env.K8S_AGENT_IMAGE_CLAUDE ??
  "ghcr.io/assembly-lime/agent-claude:latest";
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3434";
const INTERNAL_AGENT_API_KEY = process.env.INTERNAL_AGENT_API_KEY ?? "";
const BUNQUEUE_HOST = process.env.BUNQUEUE_HOST ?? "localhost";
const BUNQUEUE_PORT = process.env.BUNQUEUE_PORT ?? "6789";

export async function launchK8sJob(payload: AgentJobPayload): Promise<void> {
  const kc = new k8s.KubeConfig();
  if (process.env.KUBECONFIG) {
    kc.loadFromFile(process.env.KUBECONFIG);
  } else {
    kc.loadFromDefault();
  }
  const batchApi = kc.makeApiClient(k8s.BatchV1Api);

  const jobName = `agent-claude-${payload.runId}`;
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64");

  const job: k8s.V1Job = {
    metadata: {
      name: jobName,
      namespace: K8S_NAMESPACE,
      labels: {
        "app.kubernetes.io/part-of": "assembly-lime",
        "app.kubernetes.io/component": "agent-claude",
        "assembly-lime/run-id": String(payload.runId),
      },
    },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 600,
      activeDeadlineSeconds: payload.constraints?.timeBudgetSec ?? 600,
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/part-of": "assembly-lime",
            "app.kubernetes.io/component": "agent-claude",
          },
        },
        spec: {
          serviceAccountName: "agent-worker-sa",
          restartPolicy: "Never",
          containers: [
            {
              name: "agent",
              image: K8S_AGENT_IMAGE,
              resources: {
                requests: { cpu: "500m", memory: "512Mi" },
                limits: { cpu: "2", memory: "2Gi" },
              },
              env: [
                { name: "AGENT_JOB_PAYLOAD", value: encodedPayload },
                { name: "API_BASE_URL", value: API_BASE_URL },
                { name: "INTERNAL_AGENT_API_KEY", value: INTERNAL_AGENT_API_KEY },
                { name: "BUNQUEUE_HOST", value: BUNQUEUE_HOST },
                { name: "BUNQUEUE_PORT", value: BUNQUEUE_PORT },
                {
                  name: "ANTHROPIC_API_KEY",
                  valueFrom: {
                    secretKeyRef: {
                      name: "agent-secrets",
                      key: "ANTHROPIC_API_KEY",
                      optional: true,
                    },
                  },
                },
                { name: "CLAUDE_CODE_USE_BEDROCK", value: "1" },
                {
                  name: "AWS_REGION",
                  value: process.env.AWS_REGION ?? "us-east-1",
                },
              ],
            },
          ],
        },
      },
    },
  };

  await batchApi.createNamespacedJob({ namespace: K8S_NAMESPACE, body: job });
  logger.info({ jobName, runId: payload.runId }, "K8s job created");

  // Poll for completion
  const watch = kc.makeApiClient(k8s.BatchV1Api);
  const deadline = Date.now() + (payload.constraints?.timeBudgetSec ?? 600) * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const result = await watch.readNamespacedJob({ namespace: K8S_NAMESPACE, name: jobName });
    const status = result.status;
    if (status?.succeeded && status.succeeded > 0) {
      logger.info({ jobName }, "K8s job succeeded");
      return;
    }
    if (status?.failed && status.failed > 0) {
      throw new Error(`K8s job ${jobName} failed`);
    }
  }

  throw new Error(`K8s job ${jobName} timed out`);
}
