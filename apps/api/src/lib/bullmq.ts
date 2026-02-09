import { Queue } from "bullmq";
import { redis } from "./redis";
import {
  QUEUE_AGENT_RUNS_CLAUDE,
  QUEUE_AGENT_RUNS_CODEX,
  type AgentJobPayload,
} from "@assembly-lime/shared";

export const claudeQueue = new Queue<AgentJobPayload>(QUEUE_AGENT_RUNS_CLAUDE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const codexQueue = new Queue<AgentJobPayload>(QUEUE_AGENT_RUNS_CODEX, {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export function getQueueForProvider(
  provider: "claude" | "codex"
): Queue<AgentJobPayload> {
  return provider === "claude" ? claudeQueue : codexQueue;
}
