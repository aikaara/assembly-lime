import * as k8s from "@kubernetes/client-node";

const kc = new k8s.KubeConfig();

if (process.env.KUBECONFIG) {
  kc.loadFromFile(process.env.KUBECONFIG);
} else {
  kc.loadFromDefault();
}

export const batchApi = kc.makeApiClient(k8s.BatchV1Api);
export const appsApi = kc.makeApiClient(k8s.AppsV1Api);
export const coreApi = kc.makeApiClient(k8s.CoreV1Api);
export const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);

export const K8S_NAMESPACE = process.env.K8S_NAMESPACE ?? "assembly-lime";
export const K8S_AGENT_IMAGE_CLAUDE =
  process.env.K8S_AGENT_IMAGE_CLAUDE ?? "ghcr.io/assembly-lime/agent-claude:latest";
export const K8S_AGENT_IMAGE_CODEX =
  process.env.K8S_AGENT_IMAGE_CODEX ?? "ghcr.io/assembly-lime/agent-codex:latest";
export const PREVIEW_DOMAIN =
  process.env.PREVIEW_DOMAIN ?? "preview.assemblylime.dev";
export const PREVIEW_INGRESS_CLASS =
  process.env.PREVIEW_INGRESS_CLASS ?? "nginx";
export const USE_K8S_SANDBOX = process.env.USE_K8S_SANDBOX === "true";
