import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import type { Db } from "@assembly-lime/shared/db";
import { agentEvents, agentRuns } from "@assembly-lime/shared/db/schema";
import type { AgentEvent } from "@assembly-lime/shared";
import { broadcastToWs } from "./ws";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "internal-events" });

const INTERNAL_KEY = process.env.INTERNAL_AGENT_API_KEY ?? "";

function verifyInternalKey(provided: string): boolean {
  if (!INTERNAL_KEY || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(INTERNAL_KEY);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function internalEventRoutes(db: Db) {
  return new Elysia({ prefix: "/internal" })
    .post(
      "/agent-events/:runId",
      async ({ params, body, set, headers }) => {
        const key = headers["x-internal-key"];
        if (!key || !verifyInternalKey(key)) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const runId = Number(params.runId);
        if (Number.isNaN(runId)) {
          set.status = 400;
          return { error: "invalid runId" };
        }

        const event = body as AgentEvent;

        // 1. Look up tenant from the run
        const [run] = await db
          .select({ tenantId: agentRuns.tenantId })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId));
        if (!run) {
          log.warn({ runId }, "agent event for unknown run");
          set.status = 404;
          return { error: "run not found" };
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
        broadcastToWs(runId, event);

        return { ok: true };
      },
      {
        body: t.Any(),
        params: t.Object({ runId: t.String() }),
      }
    );
}
