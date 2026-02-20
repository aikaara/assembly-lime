// ── Agent protocol types (duplicated from packages/shared/src/protocol.ts) ──

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

// ── API response shapes ──────────────────────────────────────────────

export type AgentRunCreateResponse = {
  id: string;
  status: AgentRunStatus;
  provider: AgentProviderId;
  mode: AgentMode;
  createdAt: string;
};

export type AgentRunDetailResponse = {
  id: string;
  tenantId: string;
  projectId: string;
  ticketId: string | null;
  provider: AgentProviderId;
  mode: AgentMode;
  status: AgentRunStatus;
  inputPrompt: string;
  outputSummary: string | null;
  costCents: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
};

export type AgentEventResponse = {
  id: string;
  type: string;
  payload: unknown;
  ts: string;
};

// ── Auth types ───────────────────────────────────────────────────────

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  githubLogin: string | null;
};

export type AuthTenant = {
  id: string;
  name: string;
  slug: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  key: string;
};

export type MeResponse = {
  user: AuthUser;
  tenant: AuthTenant;
  roles: string[];
  projects: ProjectSummary[];
};

// ── Board API types ──────────────────────────────────────────────────

export type BoardResponse = {
  board: { id: string; name: string; columns: unknown };
  tickets: ApiTicket[];
};

export type ApiTicket = {
  id: string;
  title: string;
  description: string;
  column: string;
  priority: string;
  labels: string[];
  branch?: string;
  prUrl?: string;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
};

// ── Kanban types ─────────────────────────────────────────────────────

export const COLUMN_KEYS = [
  "backlog",
  "todo",
  "in_progress",
  "code_review",
  "qa",
  "done",
] as const;

export type ColumnKey = (typeof COLUMN_KEYS)[number];

export const COLUMNS: Record<ColumnKey, { label: string; color: string }> = {
  backlog: { label: "Backlog", color: "bg-zinc-600" },
  todo: { label: "Todo", color: "bg-blue-600" },
  in_progress: { label: "In Progress", color: "bg-amber-600" },
  code_review: { label: "Code Review", color: "bg-purple-600" },
  qa: { label: "QA", color: "bg-cyan-600" },
  done: { label: "Done", color: "bg-emerald-600" },
};

export type TicketPriority = "low" | "medium" | "high" | "critical";

export type Ticket = {
  id: string;
  title: string;
  description: string;
  column: ColumnKey;
  priority: TicketPriority;
  labels: string[];
  branch?: string;
  prUrl?: string;
  assignee?: string;
};

// ── Project Repository types ────────────────────────────────────────

export type ProjectRepository = {
  id: string;
  projectId: string;
  repositoryId: string;
  repoRole: number;
  isPrimary: boolean;
  repoOwner: string;
  repoName: string;
  repoFullName: string;
  cloneUrl: string;
  defaultBranch: string;
};

// ── Repository types ────────────────────────────────────────────────

export type Repository = {
  id: string;
  tenantId: string;
  connectorId: string;
  owner?: string;
  name?: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  isEnabled: boolean;
  forkOwner?: string | null;
  forkFullName?: string | null;
  forkCloneUrl?: string | null;
  forkCreatedAt?: string | null;
  createdAt: string;
};

export type RepositoryDependency = {
  id: string;
  sourceRepositoryId: string;
  targetRepositoryId: string;
  dependencyType: string;
  confidence: number;
  detectedFrom: string | null;
  metadata: Record<string, unknown>;
  lastScannedAt: string;
};

export type DependencyScanStatus = {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  reposScanned: number;
  depsFound: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type DependencyGraphResponse = {
  nodes: Repository[];
  edges: RepositoryDependency[];
};

export type FileTreeEntry = {
  path: string;
  type: "file" | "dir";
  size?: number;
  children?: FileTreeEntry[];
};

export type RepoConfig = {
  id: string;
  repositoryId: string;
  filePath: string;
  configType: string;
  detectedKeys: string[];
  createdAt: string;
};

// ── K8s types ───────────────────────────────────────────────────────

export type K8sCluster = {
  id: string;
  tenantId: string;
  name: string;
  apiUrl: string;
  status: string;
  metadataJson: unknown;
  lastSyncedAt: string | null;
  createdAt: string;
};

export type Sandbox = {
  id: string;
  tenantId: string;
  clusterId: string | null;
  repositoryId: string;
  branch: string;
  k8sNamespace: string;
  k8sPod: string;
  k8sService: string | null;
  k8sIngress: string | null;
  sandboxUrl: string | null;
  status: string;
  portsJson: unknown;
  createdAt: string;
  destroyedAt: string | null;
};

export type EnvVarSet = {
  id: string;
  tenantId: string;
  scopeType: string;
  scopeId: string;
  name: string;
  createdAt: string;
  vars?: EnvVar[];
};

export type EnvVar = {
  id: string;
  key: string;
  isSecret: boolean;
  hasValue: boolean;
  createdAt: string;
};

export type Domain = {
  id: string;
  tenantId: string;
  clusterId: string;
  domain: string;
  status: string;
  tlsCertSecret: string | null;
  createdAt: string;
};
