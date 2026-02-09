import { Elysia } from "elysia";
import type { AgentEvent } from "@assembly-lime/shared";
import { logger } from "../lib/logger";

type WsData = { runId: number };

// Map of runId → set of WebSocket connections
const subscribers = new Map<number, Set<{ send: (data: string) => void }>>();

export function broadcastToWs(runId: number, event: AgentEvent) {
  const subs = subscribers.get(runId);
  if (!subs || subs.size === 0) return;
  const payload = JSON.stringify(event);
  for (const ws of subs) {
    try {
      ws.send(payload);
    } catch {
      subs.delete(ws);
    }
  }
}

export function wsRoutes() {
  return new Elysia().ws("/ws/agent-runs/:runId", {
    open(ws) {
      const runId = Number((ws.data as { params: { runId: string } }).params.runId);
      if (Number.isNaN(runId)) {
        ws.close();
        return;
      }
      let subs = subscribers.get(runId);
      if (!subs) {
        subs = new Set();
        subscribers.set(runId, subs);
      }
      subs.add(ws as unknown as { send: (data: string) => void });
      logger.info({ runId, clients: subs.size }, "ws client connected");
    },
    message(_ws, _message) {
      // Clients don't send meaningful messages; ignore
    },
    close(ws) {
      const runId = Number((ws.data as { params: { runId: string } }).params.runId);
      const subs = subscribers.get(runId);
      if (subs) {
        subs.delete(ws as unknown as { send: (data: string) => void });
        if (subs.size === 0) subscribers.delete(runId);
        logger.info({ runId, clients: subs.size }, "ws client disconnected");
      }
    },
  });
}
