import * as k8s from "@kubernetes/client-node";
import type { Db } from "@assembly-lime/shared/db";
import type { AgentJobPayload } from "@assembly-lime/shared";
import { getClusterClient } from "./k8s-cluster.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "k8s-job-launcher" });

const K8S_AGENT_IMAGE =
  process.env.K8S_AGENT_IMAGE_CLAUDE ?? "ghcr.io/assembly-lime/agent-claude:latest";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export async function launchAgentK8sJob(
  db: Db,
  tenantId: number,
  clusterId: number,
  payload: AgentJobPayload
): Promise<string> {
  const kc = await getClusterClient(db, tenantId, clusterId);
  const batchApi = kc.makeApiClient(k8s.BatchV1Api);

  const k8sConfig = payload.k8s!;
  const repo = payload.repo!;
  const namespace = k8sConfig.namespace;
  const jobName = `al-agent-${payload.runId}`;
  const branchName = `al/${payload.mode}/${payload.runId}`;
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64");
  const deadline = payload.constraints?.timeBudgetSec ?? 600;

  const job: k8s.V1Job = {
    metadata: {
      name: jobName,
      namespace,
      labels: {
        "app.kubernetes.io/part-of": "assembly-lime",
        "app.kubernetes.io/component": "agent-claude",
        "assembly-lime/run-id": String(payload.runId),
        "assembly-lime/mode": payload.mode,
      },
    },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 300,
      activeDeadlineSeconds: deadline,
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/part-of": "assembly-lime",
            "app.kubernetes.io/component": "agent-claude",
            "assembly-lime/run-id": String(payload.runId),
          },
        },
        spec: {
          serviceAccountName: "al-agent-sa",
          restartPolicy: "Never",
          initContainers: [
            {
              name: "git-clone",
              image: "alpine/git:latest",
              command: [
                "sh",
                "-c",
                [
                  // Configure git credential store from mounted secret
                  "TOKEN=$(cat /etc/git-credentials/token)",
                  `git clone --depth 50 --branch ${repo.defaultBranch} https://x-access-token:\${TOKEN}@github.com/${repo.owner}/${repo.name}.git /workspace`,
                  "cd /workspace",
                  `git checkout -b ${branchName}`,
                  `git config user.email "agent@assemblylime.dev"`,
                  `git config user.name "Assembly Lime Agent"`,
                ].join(" && "),
              ],
              volumeMounts: [
                { name: "workspace", mountPath: "/workspace" },
                { name: "git-credentials", mountPath: "/etc/git-credentials", readOnly: true },
              ],
              env: [
                { name: "GIT_TERMINAL_PROMPT", value: "0" },
              ],
            },
          ],
          containers: [
            {
              name: "agent",
              image: K8S_AGENT_IMAGE,
              env: [
                { name: "AGENT_JOB_PAYLOAD", value: encodedPayload },
                { name: "REDIS_URL", value: REDIS_URL },
                { name: "WORKSPACE_DIR", value: "/workspace" },
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
              ],
              volumeMounts: [
                { name: "workspace", mountPath: "/workspace" },
                { name: "git-credentials", mountPath: "/etc/git-credentials", readOnly: true },
              ],
              resources: {
                requests: { cpu: "500m", memory: "512Mi" },
                limits: { cpu: "2", memory: "2Gi" },
              },
            },
          ],
          volumes: [
            {
              name: "workspace",
              emptyDir: { sizeLimit: "500Mi" },
            },
            {
              name: "git-credentials",
              secret: {
                secretName: k8sConfig.gitCredentialSecretName,
                defaultMode: 0o400,
              },
            },
          ],
        },
      },
    },
  };

  await batchApi.createNamespacedJob({ namespace, body: job });
  log.info(
    { jobName, namespace, runId: payload.runId, branch: branchName },
    "K8s agent job created"
  );

  return jobName;
}
