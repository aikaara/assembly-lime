#!/usr/bin/env bun
/**
 * Quick DB query script using Drizzle.
 * Usage: bun scripts/db-query.ts <query>
 *
 * Examples:
 *   bun scripts/db-query.ts "run 7"          — show agent_runs row + events for run 7
 *   bun scripts/db-query.ts "events 7"       — show only events for run 7
 *   bun scripts/db-query.ts "runs"            — list recent agent runs
 *   bun scripts/db-query.ts "sql SELECT ..."  — raw SQL
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, desc } from "drizzle-orm";
import postgres from "postgres";
import { agentRuns, agentEvents } from "../packages/shared/src/db/schema/agents";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set. Run with: bun --env-file .env scripts/db-query.ts ...");
  process.exit(1);
}

const client = postgres(url);
const db = drizzle(client);

const args = process.argv.slice(2).join(" ").trim();

async function main() {
  if (args.startsWith("run ")) {
    const runId = Number(args.split(" ")[1]);
    const run = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
    console.log("\n=== Agent Run ===");
    console.log(JSON.stringify(run[0] ?? "not found", null, 2));

    const events = await db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.agentRunId, runId))
      .orderBy(agentEvents.ts);
    console.log(`\n=== Events (${events.length}) ===`);
    for (const e of events) {
      console.log(`[${e.ts?.toISOString()}] ${e.type}:`, JSON.stringify(e.payloadJson));
    }
  } else if (args.startsWith("events ")) {
    const runId = Number(args.split(" ")[1]);
    const events = await db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.agentRunId, runId))
      .orderBy(agentEvents.ts);
    console.log(`Events for run ${runId} (${events.length}):`);
    for (const e of events) {
      console.log(`[${e.ts?.toISOString()}] ${e.type}:`, JSON.stringify(e.payloadJson));
    }
  } else if (args === "runs") {
    const runs = await db
      .select({
        id: agentRuns.id,
        provider: agentRuns.provider,
        mode: agentRuns.mode,
        status: agentRuns.status,
        createdAt: agentRuns.createdAt,
        inputPrompt: agentRuns.inputPrompt,
      })
      .from(agentRuns)
      .orderBy(desc(agentRuns.id))
      .limit(20);
    console.log("\n=== Recent Agent Runs ===");
    for (const r of runs) {
      console.log(
        `#${r.id} [${r.provider}/${r.mode}] ${r.status} — ${r.inputPrompt?.slice(0, 80)} (${r.createdAt?.toISOString()})`
      );
    }
  } else if (args.startsWith("sql ")) {
    const rawSql = args.slice(4);
    const result = await client.unsafe(rawSql);
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("Usage:");
    console.log('  bun scripts/db-query.ts "run 7"       — show run + events');
    console.log('  bun scripts/db-query.ts "events 7"    — show events only');
    console.log('  bun scripts/db-query.ts "runs"         — list recent runs');
    console.log('  bun scripts/db-query.ts "sql SELECT 1" — raw SQL');
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
