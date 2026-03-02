# Deployment Strategy — Assembly Lime

**Date:** March 2, 2026

---

## How PMs Deploy with Assembly Lime

Assembly Lime treats deployment as a PM-controlled activity, not an ops ritual. The PM who approved the code should be the one who ships it — with safety rails at every step.

---

## Deployment Lifecycle

```
Code Approved → Preview Sandbox → PM Verifies → PR Merged → Pipeline Triggered → Deployed
      |               |                |              |               |              |
   PM action     Automatic        PM action      PM action      Automatic       Visible
```

### 1. Preview Deployments (Live Today)

Every Implement and Bugfix agent run produces a **live preview** inside a Daytona sandbox:

- Agent completes code → starts a dev server inside the sandbox automatically
- PM receives a preview URL in the Command Center transcript
- PM clicks through the UI, tests the flow, verifies behavior visually
- Preview runs on the agent's feature branch — completely isolated from production

The PM sees exactly what will ship before approving anything. No "deploy to staging and wait 20 minutes."

### 2. PR Creation (Approval Gate)

When the PM approves an agent run:

1. Agent commits final changes to the feature branch (`al/{mode}/{runId}`)
2. Agent creates a GitHub Pull Request with:
   - Descriptive title and summary generated from the agent transcript
   - Link back to the Assembly Lime run for full audit trail
   - Branch protection rules enforced by GitHub (CI checks, required reviewers)
3. Ticket on the Kanban board auto-moves to **Code Review**

The PM controls when this happens. No PR is created without explicit approval.

### 3. CI/CD Pipeline Integration (Planned)

Assembly Lime tracks deployment pipelines through the full lifecycle:

**Data model (schema deployed):**

| Entity | Purpose |
|--------|---------|
| `build_pipelines` | GitHub Actions workflow definitions linked to repositories |
| `pipeline_runs` | Individual CI/CD execution records (status, duration, logs) |
| `deployment_targets` | Environments: dev, staging, production — with URLs and config |
| `deployments` | Deployment records: which target, which commit, who triggered |
| `deployment_steps` | Granular steps within a deployment (build, test, deploy, verify) |

**What PMs will see:**

- Pipeline status badges on Kanban cards and PR links
- Build/deploy history per repository
- One-click deploy to a target environment after PR merge
- Deployment step progress in real time (build → test → deploy → verify)
- Rollback visibility if a deployment fails

### 4. Natural Language Deployment (Vision)

The end state:

```
PM: "Deploy the billing feature to staging."

Agent:
  → Identifies the merged PR for the billing feature
  → Triggers the staging deployment pipeline
  → Monitors pipeline steps in real time
  → Reports: "Deployed to staging. Health check passed.
     URL: https://staging.app.com"
```

```
PM: "Promote staging to production."

Agent:
  → Runs pre-production checklist (tests green, no open blockers)
  → Triggers production deployment pipeline
  → Monitors rollout (canary → full)
  → Reports: "Production deploy complete. 0 errors in first 5 minutes."
```

---

## Deployment Safety Model

| Risk | Mitigation |
|------|-----------|
| Deploying untested code | Agent runs test suite in sandbox before presenting diff; test results visible in transcript |
| Deploying without PM approval | Approval gate blocks PR creation; deployment pipelines require merged PR |
| Breaking production | Preview sandbox verification first; branch protection on main; pipeline health checks |
| No rollback plan | Deployment steps tracked; rollback to previous deployment target state supported |
| Secret exposure during deploy | Env vars encrypted at rest; provided via secure input bar; never in agent prompts or logs |
| Unknown deployment status | Pipeline run status streamed to dashboard; PM sees build/test/deploy/verify in real time |

---

## PM Deployment Workflow Summary

| Stage | PM Action | System Action |
|-------|----------|---------------|
| **Preview** | Click preview URL, verify visually | Agent starts dev server in sandbox |
| **Approve** | Click "Approve" in Command Center | Agent creates PR on GitHub |
| **Merge** | Merge PR on GitHub (or via dashboard) | CI pipeline triggered automatically |
| **Monitor** | Watch pipeline progress in dashboard | Pipeline steps streamed in real time |
| **Verify** | Check deployment target health | Health checks run automatically post-deploy |
| **Rollback** | Trigger rollback if needed | Previous stable state restored |

---

The PM who approved the code sees it all the way to production — no handoff to a release manager, no "when is this going out?" Slack messages. **Describe it. Review it. Ship it.**

---

*Assembly Lime — Built by Aikaara*
