import type Redis from "ioredis";
import { agentEventsChannel, type AgentEvent } from "@assembly-lime/shared";

export class AgentEventEmitter {
  private publisher: Redis;
  private runId: number;
  private channel: string;

  constructor(publisher: Redis, runId: number) {
    this.publisher = publisher;
    this.runId = runId;
    this.channel = agentEventsChannel(runId);
  }

  async emit(event: AgentEvent): Promise<void> {
    await this.publisher.publish(this.channel, JSON.stringify(event));
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
