import type { AgentEvent } from "@assembly-lime/shared";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost:3434").replace(/\/$/, "");
const INTERNAL_KEY = process.env.INTERNAL_AGENT_API_KEY ?? "";

export interface LlmCallDump {
  turnNumber: number;
  model: string;
  provider: string;
  systemPromptHash?: string;
  messagesJson?: unknown;
  responseJson?: unknown;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costCents: number;
  stopReason?: string;
  durationMs?: number;
}

export interface RunRepoData {
  repositoryId: number;
  branch: string;
  status: string;
  diffSummary?: string;
}

export interface CodeDiffData {
  repositoryId: number;
  baseRef: string;
  headRef: string;
  unifiedDiff: string;
  summary?: string;
}

export class AgentEventEmitter {
  private runId: number;
  private url: string;
  private baseUrl: string;

  constructor(runId: number) {
    this.runId = runId;
    this.baseUrl = API_BASE_URL;
    this.url = `${API_BASE_URL}/internal/agent-events/${runId}`;
  }

  async emit(event: AgentEvent): Promise<void> {
    await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-key": INTERNAL_KEY,
      },
      body: JSON.stringify(event),
    });
  }

  async emitStatus(
    status: "queued" | "running" | "completed" | "failed" | "cancelled" | "awaiting_approval" | "awaiting_followup" | "plan_approved",
    message?: string
  ): Promise<void> {
    await this.emit({ type: "status", status, message });
  }

  async emitMessage(
    role: "system" | "assistant" | "tool",
    text: string
  ): Promise<void> {
    await this.emit({ type: "message", role, text });
  }

  async emitLog(text: string): Promise<void> {
    await this.emit({ type: "log", text });
  }

  async emitDiff(unifiedDiff: string, summary?: string): Promise<void> {
    await this.emit({ type: "diff", unifiedDiff, summary });
  }

  async emitError(message: string, stack?: string): Promise<void> {
    await this.emit({ type: "error", message, stack });
  }

  async emitArtifact(
    name: string,
    url?: string,
    mime?: string
  ): Promise<void> {
    await this.emit({ type: "artifact", name, url, mime });
  }

  private async postInternal(path: string, data: unknown): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/internal/${path}/${this.runId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-key": INTERNAL_KEY,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`[emitter] POST /internal/${path}/${this.runId} failed: ${res.status} ${text}`);
      }
    } catch (err) {
      console.warn(`[emitter] POST /internal/${path}/${this.runId} error:`, err);
    }
  }

  async emitLlmCallDump(dump: LlmCallDump): Promise<void> {
    await this.postInternal("llm-call-dumps", dump);
  }

  async emitRunRepo(data: RunRepoData): Promise<void> {
    await this.postInternal("agent-run-repos", data);
  }

  async emitCodeDiff(data: CodeDiffData): Promise<void> {
    await this.postInternal("code-diffs", data);
  }

  async emitSandboxInfo(sandboxId: string, repoDir: string): Promise<void> {
    await this.postInternal("agent-sandbox-info", { sandboxId, repoDir });
  }

  // ── Session persistence ──

  async emitSessionSnapshot(messages: unknown[]): Promise<void> {
    await this.postInternal("agent-session", { messages });
  }

  async loadSessionSnapshot(): Promise<unknown[] | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/internal/agent-session/${this.runId}`,
        {
          headers: { "x-internal-key": INTERNAL_KEY },
        },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { messages: unknown[] | null };
      return data.messages;
    } catch {
      return null;
    }
  }

  async emitTasks(
    tasks: Array<{ title: string; description?: string }>
  ): Promise<Array<{ ticketId: string; title: string }>> {
    const res = await fetch(`${this.baseUrl}/internal/agent-tasks/${this.runId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-key": INTERNAL_KEY,
      },
      body: JSON.stringify({ tasks }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create tasks: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { tickets: Array<{ ticketId: string; title: string }> };

    // Initialize task list for tracking
    this.taskList = data.tickets.map((t) => ({
      ticketId: t.ticketId,
      title: t.title,
      status: "pending" as const,
    }));

    return data.tickets;
  }

  // ── User message polling (for follow-up loop) ──

  async pollUserMessages(afterEventId: number): Promise<Array<{ id: number; text: string; ts: string }>> {
    try {
      const res = await fetch(
        `${this.baseUrl}/internal/user-messages/${this.runId}?after=${afterEventId}`,
        {
          headers: { "x-internal-key": INTERNAL_KEY },
        },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as {
        messages: Array<{ id: string; text: string; ts: string }>;
      };
      return data.messages.map((m) => ({ id: Number(m.id), text: m.text, ts: m.ts }));
    } catch {
      return [];
    }
  }

  // ── Run status polling (for cancellation detection) ──

  async pollRunStatus(): Promise<string | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/internal/agent-run-status/${this.runId}`,
        {
          headers: { "x-internal-key": INTERNAL_KEY },
        },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { status: string };
      return data.status;
    } catch {
      return null;
    }
  }

  // ── Task progress tracking ──

  private taskList: Array<{
    ticketId: string;
    title: string;
    description?: string;
    status: "pending" | "in_progress" | "completed";
  }> = [];

  getTaskList() {
    return this.taskList;
  }

  async updateTaskStatus(
    ticketId: string,
    status: "in_progress" | "completed",
  ): Promise<void> {
    const task = this.taskList.find((t) => t.ticketId === ticketId);
    if (task) {
      task.status = status;
    }
    // Re-emit full task list
    await this.emit({
      type: "tasks",
      tasks: this.taskList,
    });
  }
}
