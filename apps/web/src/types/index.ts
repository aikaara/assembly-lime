// ── Agent protocol types (duplicated from packages/shared/src/protocol.ts) ──

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
