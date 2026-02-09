import { eq } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { agentEvents, agentRuns } from "@assembly-lime/shared/db/schema";
import type { AgentEvent, AgentRunStatus } from "@assembly-lime/shared";
import { redisSub } from "../lib/redis";
import { logger } from "../lib/logger";

type WsBroadcaster = (runId: number, event: AgentEvent) => void;

/**
 * Subscribes to all Redis `agent-events:*` channels via pattern subscription.
 * For each event received:
 *  1. Persist to agent_events table
 *  2. If status event, update agent_runs status
 *  3. Broadcast to WebSocket clients
 */
export async function startEventSubscriber(db: Db, broadcast: WsBroadcaster) {
  await redisSub.psubscribe("agent-events:*");

  redisSub.on("pmessage", async (_pattern, channel, message) => {
    const runIdStr = channel.split(":")[1];
    if (!runIdStr) return;
    const runId = Number(runIdStr);
    if (Number.isNaN(runId)) return;

    let event: AgentEvent;
    try {
      event = JSON.parse(message) as AgentEvent;
    } catch {
      logger.warn({ channel, message }, "invalid agent event JSON");
      return;
    }

    // 1. Look up tenant from the run
    const [run] = await db
      .select({ tenantId: agentRuns.tenantId })
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));
    if (!run) {
      logger.warn({ runId }, "agent event for unknown run");
      return;
    }

    // 2. Persist event
    await db.insert(agentEvents).values({
      tenantId: run.tenantId,
      agentRunId: runId,
      type: event.type,
      payloadJson: event,
    });

    // 3. Update run status if this is a status event
    if (event.type === "status") {
      const updates: Record<string, unknown> = { status: event.status };
      if (event.status === "running") {
        updates.startedAt = new Date();
      } else if (
        event.status === "completed" ||
        event.status === "failed" ||
        event.status === "cancelled"
      ) {
        updates.endedAt = new Date();
        if (event.message) {
          updates.outputSummary = event.message;
        }
      }
      await db.update(agentRuns).set(updates).where(eq(agentRuns.id, runId));
    }

    // 4. Broadcast to WebSocket
    broadcast(runId, event);
  });

  logger.info("event subscriber started (pattern: agent-events:*)");
}
