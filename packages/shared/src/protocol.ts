export type AgentProviderId = "codex" | "claude";
export type AgentMode = "plan" | "implement" | "bugfix" | "review";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type PreviewDeploymentStatus =
  | "pending"
  | "deploying"
  | "active"
  | "destroying"
  | "destroyed"
  | "failed";

export type AgentRunRequest = {
  runId: string;
  tenantId: string;
  projectId?: string;
  ticketId?: string;
  mode: AgentMode;
  prompt: string;
  repo?: {
    repositoryId: string;
    cloneUrl: string;
    defaultBranch: string;
    ref?: string;
    allowedPaths?: string[];
  };
  constraints?: {
    timeBudgetSec?: number;
    maxCostCents?: number;
    allowedTools?: string[];
  };
};

export type ImageAttachment = {
  imageId: string;
  s3Key: string;
  fileName: string;
  mimeType: string;
  presignedUrl?: string;
};

export type AgentJobPayload = {
  runId: number;
  tenantId: number;
  projectId: number;
  ticketId?: number;
  provider: AgentProviderId;
  mode: AgentMode;
  resolvedPrompt: string;
  inputPrompt: string;
  repo?: {
    repositoryId: number;
    cloneUrl: string;
    defaultBranch: string;
    ref?: string;
    allowedPaths?: string[];
  };
  constraints?: {
    timeBudgetSec?: number;
    maxCostCents?: number;
    allowedTools?: string[];
  };
  images?: ImageAttachment[];
};

export type AgentEvent =
  | { type: "message"; role: "system" | "assistant" | "tool"; text: string }
  | { type: "log"; text: string }
  | { type: "diff"; unifiedDiff: string; summary?: string }
  | { type: "artifact"; name: string; url?: string; mime?: string }
  | { type: "error"; message: string; stack?: string }
  | { type: "status"; status: AgentRunStatus; message?: string }
  | {
      type: "preview";
      previewUrl: string;
      branch: string;
      status: PreviewDeploymentStatus;
    };

// ── Queue constants ──────────────────────────────────────────────────
export const QUEUE_AGENT_RUNS_CLAUDE = "agent-runs-claude";
export const QUEUE_AGENT_RUNS_CODEX = "agent-runs-codex";

// ── Redis pub/sub channel helpers ────────────────────────────────────
export function agentEventsChannel(runId: number | string): string {
  return `agent-events:${runId}`;
}
