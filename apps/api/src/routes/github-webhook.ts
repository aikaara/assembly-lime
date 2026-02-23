import { Elysia } from "elysia";
import { createHmac, timingSafeEqual } from "crypto";
import { eq, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import {
  webhooks,
  repositories,
  tickets,
  agentRunRepos,
  pipelineRuns,
  buildPipelines,
} from "@assembly-lime/shared/db/schema";
import { decryptToken } from "../lib/encryption";
import { dispatchDepScan } from "../lib/queue";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "github-webhook" });

const GLOBAL_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

// ── Signature verification ──────────────────────────────────────────

function verifySignature(
  payload: string,
  secret: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── GitHub payload types (minimal) ──────────────────────────────────

interface GhRepository {
  full_name: string;
  owner: { login: string };
  name: string;
  default_branch: string;
}

interface GhPushPayload {
  ref: string;
  after: string;
  commits: Array<{ added: string[]; modified: string[]; removed: string[] }>;
  repository: GhRepository;
}

interface GhPullRequestPayload {
  action: string;
  pull_request: {
    number: number;
    html_url: string;
    title: string;
    merged: boolean;
    head: { ref: string };
    base: { ref: string };
    user: { login: string };
  };
  repository: GhRepository;
}

interface GhPullRequestReviewPayload {
  action: string;
  review: {
    state: string; // "approved" | "changes_requested" | "commented"
    user: { login: string };
    html_url: string;
  };
  pull_request: {
    number: number;
    head: { ref: string };
  };
  repository: GhRepository;
}

interface GhIssuesPayload {
  action: string;
  issue: {
    number: number;
    title: string;
    state: string;
    html_url: string;
    labels: Array<{ name: string }>;
  };
  repository: GhRepository;
}

interface GhIssueCommentPayload {
  action: string;
  comment: {
    body: string;
    user: { login: string };
    html_url: string;
  };
  issue: {
    number: number;
    title: string;
    pull_request?: { url: string };
  };
  repository: GhRepository;
}

interface GhWorkflowRunPayload {
  action: string;
  workflow_run: {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    html_url: string;
    head_branch: string;
    created_at: string;
    updated_at: string;
  };
  repository: GhRepository;
}

// ── Config file patterns that trigger dep-scan ──────────────────────

const CONFIG_FILE_PATTERNS = [
  "package.json",
  "package-lock.json",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
  "requirements.txt",
  "Pipfile",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  ".env.example",
  "docker-compose.yml",
  "Dockerfile",
];

function touchesConfigFiles(commits: GhPushPayload["commits"]): boolean {
  for (const commit of commits) {
    const allFiles = [...commit.added, ...commit.modified, ...commit.removed];
    for (const file of allFiles) {
      const basename = file.split("/").pop() ?? file;
      if (CONFIG_FILE_PATTERNS.includes(basename)) return true;
    }
  }
  return false;
}

// ── Route ───────────────────────────────────────────────────────────

export function githubWebhookRoutes(db: Db) {
  return new Elysia().post("/github/webhook", async ({ request, set }) => {
    // 1. Read raw body for signature verification
    const rawBody = await request.text();
    const eventType = request.headers.get("x-github-event");
    const deliveryId = request.headers.get("x-github-delivery");
    const signatureHeader = request.headers.get("x-hub-signature-256");

    if (!eventType) {
      set.status = 400;
      return { error: "missing x-github-event header" };
    }

    // Handle GitHub's ping event (sent when webhook is first created)
    if (eventType === "ping") {
      log.info({ deliveryId }, "github webhook ping received");
      return { ok: true, message: "pong" };
    }

    // 2. Parse payload to extract repo info
    let payload: { repository?: GhRepository };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      set.status = 400;
      return { error: "invalid JSON" };
    }

    const repoFullName = payload.repository?.full_name;
    if (!repoFullName) {
      set.status = 400;
      return { error: "missing repository in payload" };
    }

    // 3. Look up webhook by targetPath to get the secret
    const [webhook] = await db
      .select()
      .from(webhooks)
      .where(
        and(
          eq(webhooks.targetPath, repoFullName),
          eq(webhooks.status, 1),
        ),
      );

    let tenantId: number;

    if (webhook) {
      // 4a. Verify HMAC signature against per-repo secret
      const secret = decryptToken(webhook.secretEnc);
      if (!verifySignature(rawBody, secret, signatureHeader)) {
        log.warn({ repoFullName, deliveryId }, "webhook signature verification failed");
        set.status = 401;
        return { error: "invalid signature" };
      }
      tenantId = webhook.tenantId;
    } else {
      // 4b. No registered webhook — verify global secret if configured, otherwise skip
      if (GLOBAL_WEBHOOK_SECRET && !verifySignature(rawBody, GLOBAL_WEBHOOK_SECRET, signatureHeader)) {
        log.warn({ repoFullName, deliveryId }, "global webhook signature verification failed");
        set.status = 401;
        return { error: "invalid signature" };
      }

      // Look up repo by fullName to find the tenant
      const [repo] = await db
        .select({ tenantId: repositories.tenantId })
        .from(repositories)
        .where(eq(repositories.fullName, repoFullName))
        .limit(1);

      if (!repo) {
        log.warn({ repoFullName, deliveryId }, "webhook received for unknown repo");
        set.status = 404;
        return { error: "repository not found" };
      }

      tenantId = repo.tenantId;
      log.info({ repoFullName, tenantId, deliveryId }, "processing webhook via repo fallback (no registered webhook)");
    }

    // 5. Look up the full repository record
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.tenantId, tenantId),
          eq(repositories.fullName, repoFullName),
        ),
      );

    log.info(
      { eventType, deliveryId, repoFullName, tenantId },
      "github webhook event received",
    );

    // 6. Dispatch to event handler
    try {
      switch (eventType) {
        case "push":
          await handlePush(db, tenantId, repo, payload as GhPushPayload);
          break;
        case "pull_request":
          await handlePullRequest(db, tenantId, repo, payload as GhPullRequestPayload);
          break;
        case "pull_request_review":
          await handlePullRequestReview(db, tenantId, repo, payload as GhPullRequestReviewPayload);
          break;
        case "issues":
          await handleIssues(db, tenantId, repo, payload as GhIssuesPayload);
          break;
        case "issue_comment":
          await handleIssueComment(db, tenantId, repo, payload as GhIssueCommentPayload);
          break;
        case "workflow_run":
          await handleWorkflowRun(db, tenantId, repo, payload as GhWorkflowRunPayload);
          break;
        default:
          log.info({ eventType, deliveryId }, "unhandled webhook event type");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ eventType, deliveryId, repoFullName, err: msg }, "webhook handler error");
      // Return 200 anyway — GitHub retries on 5xx and we don't want retry storms
    }

    return { ok: true };
  });
}

// ── Event handlers ──────────────────────────────────────────────────

type RepoRow = typeof repositories.$inferSelect | undefined;

async function handlePush(
  db: Db,
  tenantId: number,
  repo: RepoRow,
  payload: GhPushPayload,
) {
  const branch = payload.ref.replace("refs/heads/", "");
  const commitSha = payload.after;

  log.info(
    { tenantId, repo: payload.repository.full_name, branch, commitSha },
    "push event",
  );

  // If config files were touched, trigger dep-scan
  if (payload.commits && touchesConfigFiles(payload.commits)) {
    log.info({ tenantId, repo: payload.repository.full_name }, "config files changed, dispatching dep-scan");
    dispatchDepScan(tenantId).catch((err) => {
      log.warn({ tenantId, err }, "failed to dispatch dep-scan from webhook");
    });
  }

  // If the push is to a branch that matches an agent run (al/* branches),
  // update the agent_run_repos status
  if (repo && branch.startsWith("al/")) {
    await db
      .update(agentRunRepos)
      .set({ status: "pushed" })
      .where(
        and(
          eq(agentRunRepos.tenantId, tenantId),
          eq(agentRunRepos.repositoryId, repo.id),
          eq(agentRunRepos.branch, branch),
        ),
      );
  }
}

async function handlePullRequest(
  db: Db,
  tenantId: number,
  repo: RepoRow,
  payload: GhPullRequestPayload,
) {
  const { action, pull_request: pr } = payload;
  const headBranch = pr.head.ref;

  log.info(
    { tenantId, repo: payload.repository.full_name, action, prNumber: pr.number, headBranch },
    "pull_request event",
  );

  if (!repo) return;

  // Link PR to tickets that reference this repo + branch
  if (action === "opened" || action === "reopened") {
    // Move matching tickets to "code_review" and set prUrl
    const updated = await db
      .update(tickets)
      .set({
        columnKey: "code_review",
        prUrl: pr.html_url,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tickets.tenantId, tenantId),
          eq(tickets.repositoryId, repo.id),
          eq(tickets.branch, headBranch),
        ),
      )
      .returning({ id: tickets.id });

    if (updated.length > 0) {
      log.info(
        { tenantId, ticketIds: updated.map((t) => t.id), prUrl: pr.html_url },
        "tickets moved to code_review",
      );
    }
  }

  if (action === "closed" && pr.merged) {
    // Move matching tickets to "done"
    const updated = await db
      .update(tickets)
      .set({
        columnKey: "done",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tickets.tenantId, tenantId),
          eq(tickets.repositoryId, repo.id),
          eq(tickets.branch, headBranch),
        ),
      )
      .returning({ id: tickets.id });

    if (updated.length > 0) {
      log.info(
        { tenantId, ticketIds: updated.map((t) => t.id) },
        "tickets moved to done (PR merged)",
      );
    }

    // Also update agent_run_repos status to "merged"
    await db
      .update(agentRunRepos)
      .set({ status: "merged" })
      .where(
        and(
          eq(agentRunRepos.tenantId, tenantId),
          eq(agentRunRepos.repositoryId, repo.id),
          eq(agentRunRepos.branch, headBranch),
        ),
      );
  }

  if (action === "closed" && !pr.merged) {
    // PR was closed without merging — update agent_run_repos
    await db
      .update(agentRunRepos)
      .set({ status: "closed" })
      .where(
        and(
          eq(agentRunRepos.tenantId, tenantId),
          eq(agentRunRepos.repositoryId, repo.id),
          eq(agentRunRepos.branch, headBranch),
        ),
      );
  }
}

async function handlePullRequestReview(
  db: Db,
  tenantId: number,
  repo: RepoRow,
  payload: GhPullRequestReviewPayload,
) {
  const { action, review, pull_request: pr } = payload;

  if (action !== "submitted") return;

  log.info(
    {
      tenantId,
      repo: payload.repository.full_name,
      prNumber: pr.number,
      reviewState: review.state,
      reviewer: review.user.login,
    },
    "pull_request_review event",
  );

  if (!repo) return;

  const headBranch = pr.head.ref;

  // If changes requested, move ticket back to "in_progress"
  if (review.state === "changes_requested") {
    const updated = await db
      .update(tickets)
      .set({
        columnKey: "in_progress",
        statusMetaJson: {
          reviewState: "changes_requested",
          reviewer: review.user.login,
          reviewUrl: review.html_url,
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tickets.tenantId, tenantId),
          eq(tickets.repositoryId, repo.id),
          eq(tickets.branch, headBranch),
        ),
      )
      .returning({ id: tickets.id });

    if (updated.length > 0) {
      log.info(
        { tenantId, ticketIds: updated.map((t) => t.id), reviewer: review.user.login },
        "tickets moved back to in_progress (changes requested)",
      );
    }
  }

  // If approved, move ticket to "qa"
  if (review.state === "approved") {
    const updated = await db
      .update(tickets)
      .set({
        columnKey: "qa",
        statusMetaJson: {
          reviewState: "approved",
          reviewer: review.user.login,
          reviewUrl: review.html_url,
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tickets.tenantId, tenantId),
          eq(tickets.repositoryId, repo.id),
          eq(tickets.branch, headBranch),
        ),
      )
      .returning({ id: tickets.id });

    if (updated.length > 0) {
      log.info(
        { tenantId, ticketIds: updated.map((t) => t.id), reviewer: review.user.login },
        "tickets moved to qa (approved)",
      );
    }
  }
}

async function handleIssues(
  db: Db,
  tenantId: number,
  repo: RepoRow,
  payload: GhIssuesPayload,
) {
  const { action, issue } = payload;

  log.info(
    {
      tenantId,
      repo: payload.repository.full_name,
      action,
      issueNumber: issue.number,
      issueTitle: issue.title,
    },
    "issues event",
  );

  // For now, log the event. Full issue-to-ticket sync can be built on top of this.
  // Possible future: auto-create tickets from new GitHub issues,
  // or close tickets when linked issues are closed.
}

async function handleIssueComment(
  db: Db,
  tenantId: number,
  repo: RepoRow,
  payload: GhIssueCommentPayload,
) {
  const { action, comment, issue } = payload;

  if (action !== "created") return;

  log.info(
    {
      tenantId,
      repo: payload.repository.full_name,
      issueNumber: issue.number,
      commenter: comment.user.login,
      isPR: !!issue.pull_request,
    },
    "issue_comment event",
  );

  // Future: trigger agent if comment mentions @assembly-lime bot
  // Future: append comment to ticket activity feed
}

async function handleWorkflowRun(
  db: Db,
  tenantId: number,
  repo: RepoRow,
  payload: GhWorkflowRunPayload,
) {
  const { action, workflow_run: run } = payload;

  log.info(
    {
      tenantId,
      repo: payload.repository.full_name,
      action,
      workflowName: run.name,
      workflowRunId: run.id,
      status: run.status,
      conclusion: run.conclusion,
    },
    "workflow_run event",
  );

  if (!repo) return;

  // Find matching pipeline by repo
  const [pipeline] = await db
    .select()
    .from(buildPipelines)
    .where(
      and(
        eq(buildPipelines.tenantId, tenantId),
        eq(buildPipelines.repositoryId, repo.id),
        eq(buildPipelines.name, run.name),
      ),
    );

  if (!pipeline) {
    log.info(
      { tenantId, repoId: repo.id, workflowName: run.name },
      "no matching pipeline found for workflow run",
    );
    return;
  }

  if (action === "requested" || action === "in_progress") {
    // Upsert pipeline run
    await db
      .insert(pipelineRuns)
      .values({
        tenantId,
        pipelineId: pipeline.id,
        externalRunId: run.id,
        status: run.status,
        conclusion: run.conclusion,
        url: run.html_url,
        startedAt: new Date(run.created_at),
      })
      .onConflictDoNothing();
  }

  if (action === "completed") {
    // Update existing pipeline run or insert if missed the start event
    const existing = await db
      .select({ id: pipelineRuns.id })
      .from(pipelineRuns)
      .where(
        and(
          eq(pipelineRuns.tenantId, tenantId),
          eq(pipelineRuns.pipelineId, pipeline.id),
          eq(pipelineRuns.externalRunId, run.id),
        ),
      );

    if (existing.length > 0) {
      await db
        .update(pipelineRuns)
        .set({
          status: run.status,
          conclusion: run.conclusion,
          completedAt: new Date(run.updated_at),
        })
        .where(eq(pipelineRuns.id, existing[0]!.id));
    } else {
      await db.insert(pipelineRuns).values({
        tenantId,
        pipelineId: pipeline.id,
        externalRunId: run.id,
        status: run.status,
        conclusion: run.conclusion,
        url: run.html_url,
        startedAt: new Date(run.created_at),
        completedAt: new Date(run.updated_at),
      });
    }
  }
}
