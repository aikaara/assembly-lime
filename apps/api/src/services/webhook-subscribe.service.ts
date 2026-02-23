import { randomBytes } from "crypto";
import { eq, and, inArray } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { webhooks, repositories } from "@assembly-lime/shared/db/schema";
import { encryptToken } from "../lib/encryption";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "webhook-subscribe" });

const GITHUB_API = "https://api.github.com";
const API_URL = process.env.API_URL ?? "http://localhost:3434";
const WEBHOOK_EVENTS = [
  "push",
  "pull_request",
  "pull_request_review",
  "issues",
  "issue_comment",
  "workflow_run",
];

/**
 * Auto-subscribe webhooks for repos that don't have one yet.
 * Safe to call as fire-and-forget — logs errors but never throws.
 */
export async function autoSubscribeWebhooks(
  db: Db,
  tenantId: number,
  connectorId: number,
  accessToken: string,
  repoFullNames: string[],
): Promise<void> {
  if (repoFullNames.length === 0) return;

  try {
    // Find which repos already have active webhooks
    const existing = await db
      .select({ targetPath: webhooks.targetPath })
      .from(webhooks)
      .where(
        and(
          eq(webhooks.tenantId, tenantId),
          eq(webhooks.status, 1),
          inArray(webhooks.targetPath, repoFullNames),
        ),
      );

    const hasWebhook = new Set(existing.map((w) => w.targetPath));
    const missing = repoFullNames.filter((name) => !hasWebhook.has(name));

    if (missing.length === 0) {
      log.info({ tenantId, total: repoFullNames.length }, "all repos already have webhooks");
      return;
    }

    log.info(
      { tenantId, total: repoFullNames.length, missing: missing.length },
      "auto-subscribing webhooks for repos",
    );

    let created = 0;
    let failed = 0;

    for (const fullName of missing) {
      try {
        const secret = randomBytes(32).toString("hex");

        // Create webhook on GitHub
        const ghRes = await fetch(`${GITHUB_API}/repos/${fullName}/hooks`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            name: "web",
            active: true,
            events: WEBHOOK_EVENTS,
            config: {
              url: `${API_URL}/github/webhook`,
              content_type: "json",
              secret,
            },
          }),
        });

        if (!ghRes.ok) {
          const text = await ghRes.text();
          // 422 usually means webhook already exists on GitHub side
          if (ghRes.status === 422 && text.includes("already exists")) {
            log.info({ fullName }, "webhook already exists on GitHub, skipping");
          } else {
            log.warn(
              { fullName, status: ghRes.status, body: text },
              "failed to create GitHub webhook",
            );
            failed++;
          }
          continue;
        }

        const ghWebhook = (await ghRes.json()) as { id: number };

        // Store in DB
        await db.insert(webhooks).values({
          tenantId,
          connectorId,
          provider: 1,
          externalWebhookId: ghWebhook.id,
          secretEnc: encryptToken(secret),
          eventsJson: WEBHOOK_EVENTS,
          targetPath: fullName,
          status: 1,
        });

        created++;
      } catch (err) {
        log.warn({ fullName, err }, "error auto-subscribing webhook");
        failed++;
      }
    }

    log.info({ tenantId, created, failed, skipped: missing.length - created - failed }, "webhook auto-subscribe complete");
  } catch (err) {
    log.error({ tenantId, err }, "webhook auto-subscribe failed");
  }
}
