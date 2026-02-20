export type AgentProviderId = "codex" | "claude";
export type AgentMode = "plan" | "implement" | "bugfix" | "review";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "awaiting_approval"
  | "awaiting_followup"
  | "plan_approved";

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
    connectorId: number;
    owner: string;
    name: string;
    cloneUrl: string;
    defaultBranch: string;
    ref?: string;
    allowedPaths?: string[];
    // Optional authentication for provider sandboxes (e.g., Daytona)
    authToken?: string;
  };
  repos?: Array<{
    repositoryId: number;
    connectorId: number;
    owner: string;
    name: string;
    fullName: string;
    cloneUrl: string;
    defaultBranch: string;
    ref?: string;
    roleLabel?: string;
    notes?: string;
    isPrimary?: boolean;
    authToken?: string;
  }>;
  constraints?: {
    timeBudgetSec?: number;
    maxCostCents?: number;
    allowedTools?: string[];
  };
  sandbox?: {
    provider: "daytona" | "k8s";
    envVars?: Record<string, string>;
  };
  k8s?: {
    clusterId: number;
    namespace: string;
    gitCredentialSecretName: string;
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
    }
  | {
      type: "compaction";
      tokensBefore: number;
      tokensAfter: number;
      summary: string;
    }
  | {
      type: "sandbox";
      sandboxId: string;
      sandboxUrl: string;
      provider: "daytona";
    }
  | {
      type: "tasks";
      tasks: Array<{
        ticketId: string;
        title: string;
        description?: string;
        status: "pending" | "in_progress" | "completed";
      }>;
    }
  | { type: "user_message"; text: string };


