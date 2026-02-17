import type { AgentEvent } from "@assembly-lime/shared";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost:3434").replace(/\/$/, "");
const INTERNAL_KEY = process.env.INTERNAL_AGENT_API_KEY ?? "";

export class AgentEventEmitter {
  private runId: number;
  private url: string;

  constructor(runId: number) {
    this.runId = runId;
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
    status: "queued" | "running" | "completed" | "failed" | "cancelled",
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
}
