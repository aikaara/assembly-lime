# Product Led AI-Native Development and Deployment

**Assembly Lime — Product Scope Document**
**Version:** 1.1
**Date:** March 2, 2026

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [The Problem](#the-problem)
3. [Business Requirements Document (BRD)](#business-requirements-document-brd)
4. [Product Vision](#product-vision)
5. [Core Product Surfaces](#core-product-surfaces)
6. [The AI Agent Architecture (PM Perspective)](#the-ai-agent-architecture-pm-perspective)
7. [Product-Led Development Workflows](#product-led-development-workflows)
8. [Testing Strategy](#testing-strategy--quality-the-pm-can-see-and-trust)
9. [Instruction Hierarchy](#instruction-hierarchy--pm-control-at-every-level)
10. [Multi-Tenant Architecture](#multi-tenant-architecture--built-for-teams)
11. [Security Model](#security-model)
12. [Key Metrics for PM Adoption](#key-metrics-for-pm-adoption)
13. [Competitive Positioning](#competitive-positioning)
14. [Roadmap](#roadmap-pm-relevant-milestones)
15. [Getting Started (PM Quick Start)](#getting-started-pm-quick-start)

---

## Executive Summary

Assembly Lime is a **product-manager-first software factory** that collapses the distance between product intent and shipped code. Instead of writing specs that get misinterpreted across handoff boundaries, PMs describe what they want in natural language — and AI agents plan it, build it, test it, and prepare it for deployment, all within a single dashboard they control.

This is not another developer tool with a PM dashboard bolted on. Assembly Lime is built from the ground up so that **the person closest to the customer — the PM — drives the entire development lifecycle** without waiting on sprint ceremonies, ticket grooming, or "it's in the backlog" responses.

**The core thesis:** When AI agents can write code, the bottleneck shifts from engineering capacity to product clarity. The PM who can articulate what to build becomes the most powerful person in the room.

---

## The Problem

### PMs Today Are Coordinators, Not Builders

The modern PM spends their day in a fragmented workflow:

1. **Write specs** in Google Docs or Notion — ambiguity creeps in
2. **Create tickets** in Jira — context gets lost in translation
3. **Groom backlogs** in ceremonies — weeks pass before anything moves
4. **Check status** across Slack, GitHub, CI dashboards — context-switching overhead
5. **Review PRs** they can't fully read — approve based on trust, not understanding
6. **Coordinate deployments** through release managers — another handoff, another delay

Each handoff is a point of information loss. By the time code ships, it often doesn't match what the PM envisioned — not because engineers are careless, but because the game of telephone between intent and implementation is fundamentally broken.

### The Cost of Handoff-Driven Development

| Metric | Traditional | With Assembly Lime |
|--------|-------------|-------------------|
| Idea → first working code | 1–3 sprints (2–6 weeks) | Minutes to hours |
| Spec → ticket breakdown | 2–4 hours of grooming | Automatic (AI planning agent) |
| Tickets → implementation start | Days to weeks (backlog queue) | Immediate (agent runs on demand) |
| Code review cycle | 1–3 days of back-and-forth | Real-time diff review in dashboard |
| PM visibility into code changes | Low (PR descriptions) | Full (streaming transcript + diffs) |
| Context loss across handoffs | High | Zero (single system of record) |

---

## Business Requirements Document (BRD)

### 1. Purpose & Objectives

| Item | Detail |
|------|--------|
| **Business Need** | Product teams lose 40–60% of cycle time to handoffs between PM, Engineering, and QA. AI-capable code generation has matured, but no tool gives PMs direct, governed control over the build-test-deploy loop. |
| **Business Objective** | Reduce idea-to-production cycle time by 70%+ by making PMs the primary operators of AI development agents, with full auditability and human-in-the-loop safety. |
| **Success Criteria** | (1) PM can go from feature description to merged PR in < 1 day. (2) Zero unapproved code reaches production. (3) Full audit trail for every change. (4) 60%+ reduction in grooming ceremony hours. |
| **Target Users** | Product Managers (primary), Engineering Leads (secondary — review & governance), QA (tertiary — verification) |
| **Out of Scope** | Direct production deployments without human approval, replacing developer judgment on architecture decisions, non-GitHub source control providers (Phase 1) |

### 2. Stakeholder Analysis

| Stakeholder | Role | Key Concern | How Assembly Lime Addresses It |
|-------------|------|-------------|-------------------------------|
| **Product Manager** | Primary user, drives all agent runs | Speed, clarity, control over what gets built | Natural-language input, real-time transcript, approval gates |
| **VP of Product** | Executive sponsor | ROI, velocity metrics, risk | Cost dashboard, audit trail, budget enforcement |
| **Engineering Lead** | Governance, code standards | Code quality, security, architectural consistency | Instruction hierarchy, Review mode, sandbox isolation |
| **QA Lead** | Verification, test coverage | Regression risk, test adequacy | Agent-generated regression tests, QA column on board, test reports |
| **CISO / Security** | Compliance, data protection | Secret management, access control, audit | Encryption at rest, sandboxed execution, RBAC, event logging |
| **CTO** | Technical strategy | Scalability, vendor lock-in, integration | Multi-provider support, open event protocol, GitHub-native integration |

### 3. Functional Requirements

#### FR-1: AI-Powered Planning
| ID | Requirement | Priority | Acceptance Criteria |
|----|------------|----------|-------------------|
| FR-1.1 | PM shall describe a feature in natural language and receive a structured ticket breakdown (Epic → Stories → Tasks) | P0 | Agent produces tickets with title, description, acceptance criteria, owner role, priority, and suggested column |
| FR-1.2 | Generated tickets shall auto-populate the Kanban board upon PM approval | P0 | Tickets appear in correct columns within 5 seconds of approval |
| FR-1.3 | PM shall be able to reject a plan and provide feedback for re-planning | P0 | Agent regenerates plan incorporating PM feedback |

#### FR-2: AI-Powered Implementation
| ID | Requirement | Priority | Acceptance Criteria |
|----|------------|----------|-------------------|
| FR-2.1 | PM shall trigger code implementation from a natural-language prompt or ticket reference | P0 | Agent clones repo, creates branch, writes code, and presents diff |
| FR-2.2 | All code changes shall execute in an isolated sandbox | P0 | No sandbox run modifies production data or main branch |
| FR-2.3 | Agent shall pause for PM approval before creating a PR | P0 | Approval gate blocks PR creation; PM can approve, reject, or provide follow-up |
| FR-2.4 | Agent shall generate regression tests alongside implementation code | P1 | At minimum one test per bugfix; test coverage reported in transcript |

#### FR-3: Kanban Board Management
| ID | Requirement | Priority | Acceptance Criteria |
|----|------------|----------|-------------------|
| FR-3.1 | Board shall support 6 columns: Backlog, Todo, In Progress, Code Review, QA, Done | P0 | Drag-and-drop moves tickets, persisted immediately |
| FR-3.2 | Ticket cards shall display priority, branch, PR link, labels, and assignee | P0 | All fields visible on card without opening drawer |
| FR-3.3 | Tickets shall auto-transition columns based on agent lifecycle events | P1 | Implementation start → In Progress; PR created → Code Review |

#### FR-4: Human-in-the-Loop Controls
| ID | Requirement | Priority | Acceptance Criteria |
|----|------------|----------|-------------------|
| FR-4.1 | System shall support approval gates at plan review and pre-PR checkpoints | P0 | Agent cannot proceed past gate without explicit PM action |
| FR-4.2 | PM shall be able to provide follow-up instructions mid-run | P0 | Agent incorporates follow-up and continues |
| FR-4.3 | PM shall be able to cancel a running agent at any time | P0 | Run terminates within 10 seconds; partial work is preserved on branch |

#### FR-5: Audit & Observability
| ID | Requirement | Priority | Acceptance Criteria |
|----|------------|----------|-------------------|
| FR-5.1 | Every agent action shall be logged as a structured, replayable event | P0 | Full transcript recoverable for any historical run |
| FR-5.2 | Agent run history shall be searchable by project, mode, status, and date range | P1 | Results returned within 2 seconds |
| FR-5.3 | Cost per run (token usage, model cost) shall be tracked and visible to PMs | P1 | Cost displayed on run detail page and aggregated on project dashboard |

#### FR-6: Testing & Quality Assurance
| ID | Requirement | Priority | Acceptance Criteria |
|----|------------|----------|-------------------|
| FR-6.1 | Bugfix agent shall produce a regression test alongside every fix | P0 | Test fails without fix, passes with fix |
| FR-6.2 | Implement agent shall run existing test suites in sandbox before presenting diff | P1 | Test results visible in transcript; failing tests block approval prompt |
| FR-6.3 | Review agent shall flag missing test coverage as a review finding | P1 | Review output includes test coverage assessment |
| FR-6.4 | QA column on board shall collect tickets pending verification | P0 | Tickets in QA column are clearly separated from Code Review |

### 4. Non-Functional Requirements

| Category | Requirement | Target |
|----------|------------|--------|
| **Performance** | Agent run start (sandbox creation to first event) | < 30 seconds |
| **Performance** | WebSocket event latency (agent → PM's screen) | < 500ms |
| **Performance** | Board load time with 200+ tickets | < 2 seconds |
| **Availability** | API uptime | 99.5% (excluding planned maintenance) |
| **Security** | Secret encryption | AES-256-GCM envelope encryption at rest |
| **Security** | Agent sandbox isolation | No host filesystem or network access by default |
| **Security** | Tenant data isolation | Row-level tenant scoping on all tables |
| **Scalability** | Concurrent agent runs per tenant | 10+ |
| **Scalability** | Repositories per project | 50+ |
| **Compliance** | Audit log retention | 1 year minimum |
| **Usability** | Time to first successful agent run (new PM) | < 10 minutes |

### 5. Constraints & Assumptions

**Constraints:**
- Phase 1 supports GitHub as the sole source control provider
- AI agents require Anthropic API key (Claude) or OpenAI API key (Codex)
- Daytona cloud sandboxes required for agent execution
- PostgreSQL 16+ required for database (GIN indexes, trgm, citext)

**Assumptions:**
- PMs have basic familiarity with GitHub concepts (repos, branches, PRs)
- Target organizations have codebases hosted on GitHub
- Internet connectivity is available for all users (no offline mode in Phase 1)
- Organizations will install the Assembly Lime GitHub App on their target orgs

### 6. Dependencies

| Dependency | Type | Risk | Mitigation |
|-----------|------|------|------------|
| Anthropic Claude API | External service | API downtime, rate limits, pricing changes | Multi-provider support (Codex fallback), budget alerts |
| GitHub API & App | External service | Rate limits, OAuth changes | Token refresh logic, installation token caching |
| Daytona Sandbox | External service | Sandbox provisioning delays | Sandbox pooling (planned), graceful timeout handling |
| Trigger.dev | External service | Queue processing delays | Retry logic, dead letter handling, dashboard monitoring |
| PostgreSQL (DigitalOcean) | Managed infrastructure | Connection limits, storage | Connection pooling, query optimization, managed scaling |

---

## Product Vision

### "Describe it. Review it. Ship it."

Assembly Lime gives PMs a **three-step loop** that replaces the entire traditional development workflow:

```
 Describe          Review           Ship
    |                 |               |
    v                 v               v
 [Prompt] ——→ [AI Plans & Builds] ——→ [PM Approves] ——→ [PR Created / Deployed]
    ^                                                          |
    |__________________________________________________________|
                        Iterate
```

The PM never leaves the dashboard. They describe features in natural language, watch AI agents break them down into tickets, write the code in secure sandboxes, and present diffs for approval. The PM reviews, approves or rejects, and the cycle continues — all in real time.

---

## Core Product Surfaces

### 1. Command Center — The PM's Control Room

The Command Center is Assembly Lime's primary interface. It is a **chat-first prompt interface** where PMs interact directly with AI agents.

#### How a PM Uses It

**Step 1: Describe the work**
The PM types a natural-language request into the prompt area:
> "Add a dark mode toggle to the settings page. It should persist the user's preference in localStorage and apply a dark theme using our existing Tailwind dark: variants."

**Step 2: Choose the mode**
Four mode chips let the PM select the type of work:

| Mode | What It Does | When a PM Uses It |
|------|-------------|-------------------|
| **Plan** | Converts a feature request into structured tickets (Epic + Stories + Tasks) with acceptance criteria, owner roles, and suggested board columns | Starting a new feature or initiative — the PM wants a structured breakdown before any code is written |
| **Implement** | Agent writes code in a sandboxed environment, creates a branch, commits, and pauses for PM approval before creating a PR | The PM is ready for code — either from a planned ticket or a direct request |
| **Bugfix** | Agent locates root cause, writes a minimal fix + regression test, produces a diff and explanation | A bug report comes in and the PM wants a quick turnaround |
| **Review** | Agent reviews a diff for correctness, security, performance, and style — outputs actionable feedback | The PM wants a second opinion on code changes before approving |

**Step 3: Watch it happen (Streaming Transcript)**
Once submitted, the Command Center transforms into a real-time transcript showing every step the agent takes:

- **Agent messages** — the AI's reasoning and progress updates, rendered as Markdown
- **Tool calls** — collapsible sections showing what the agent is doing (reading files, running commands)
- **Code diffs** — unified diffs rendered inline with syntax highlighting
- **Created tickets** — numbered lists of tickets the agent created on the board
- **Preview URLs** — live preview links to see changes running in a sandbox
- **Status transitions** — clear markers as the run progresses through its lifecycle

**Step 4: Approve or redirect**
At key checkpoints, the agent pauses and asks for PM input:

- **Approval gate** — "Here's the plan / code. Approve or reject?" The PM reviews diffs, checks the approach, and decides
- **Follow-up input** — "I need clarification on X." The PM responds inline, and the agent continues
- **Environment variables** — "This repo needs these env vars." The PM provides values securely

This human-in-the-loop design ensures the PM is always in control. The AI proposes, the PM disposes.

#### Why This Matters for PMs

The Command Center eliminates the "throw it over the wall" pattern. The PM doesn't write a spec, hand it to engineering, and wait. They describe what they want, watch it get built, and approve or course-correct in real time. The feedback loop shrinks from weeks to minutes.

---

### 2. Kanban Board — Familiar Territory, AI-Powered

The Board is a **drag-and-drop Kanban** with six columns that PMs already know how to use:

```
Backlog → Todo → In Progress → Code Review → QA → Done
```

#### What Makes It Different

**AI-generated tickets:** When a PM runs a `Plan` agent, the board auto-populates with structured tickets — complete with titles, descriptions, acceptance criteria, priority levels, and suggested assignees (PM / Dev / QA). No more 2-hour grooming sessions.

**Live agent status on cards:** Each Kanban card shows:
- Priority indicator (color-coded left border: critical, high, medium, low)
- Git branch badge — the agent's working branch for this ticket
- PR link — direct link to the GitHub pull request
- Labels — categorization tags
- Assignee — who's responsible (human or agent)

**One-click implementation:** From any ticket, the PM can trigger an `Implement` agent run. The ticket moves to "In Progress" automatically, and the PM watches the implementation in the Command Center.

**Automatic column transitions:** As the agent progresses through its workflow, tickets move across the board:
- Agent starts implementing → card moves to `In Progress`
- Agent creates a PR → card moves to `Code Review`
- Agent-created tasks land in `Backlog` or `Todo` based on the plan

#### Why This Matters for PMs

The board is the PM's source of truth. It shows not just what's planned, but what's actively being built by AI agents, what's awaiting approval, and what's shipped. Every card is a direct link back to the agent transcript that created it.

---

### 3. Agent Runs Dashboard — Full Audit Trail

Every AI agent run is logged, searchable, and replayable. The Agent Runs page shows:

- **Run ID** — unique identifier, clickable to replay the full transcript
- **Provider** — which AI model was used (Claude or Codex)
- **Mode** — plan / implement / bugfix / review
- **Status** — real-time lifecycle state
- **Input prompt** — what the PM originally asked for
- **Timestamps** — when it started, when it completed

#### Why This Matters for PMs

Full auditability. When stakeholders ask "why was this built this way?" or "what changed in this release?", the PM can pull up the exact agent transcript, see every decision, every line of code, and every approval. No more reconstructing history from Slack threads and PR descriptions.

---

### 4. Repository & Connector Management — Connect Once, Use Forever

PMs connect their organization's GitHub account once via a secure connector:

1. Add a GitHub connector with a Personal Access Token
2. Sync repositories — Assembly Lime imports all accessible repos
3. Link repos to projects — associate repositories with the projects they serve

From there, agents automatically know which repos to work in. When a PM says "add dark mode to the settings page," the agent identifies the correct repository (or asks the PM to confirm), clones it into a secure sandbox, and starts working.

**Repository intelligence:**
- File tree browser — PMs can explore repo structure without leaving the dashboard
- Config detection — automatically identifies frameworks, languages, and tools
- Dependency graph — visualizes how repos depend on each other

---

## The AI Agent Architecture (PM Perspective)

### What Happens When You Click "Run Agent"

From the PM's perspective, the agent is a tireless junior developer who:

1. **Reads the brief** — understands the PM's natural-language request
2. **Checks the context** — reads project-level, repo-level, and ticket-level custom instructions
3. **Clones the code** — sets up a fresh, isolated sandbox with the latest code
4. **Creates a branch** — `al/{mode}/{runId}` — so changes are always isolated
5. **Does the work** — plans tickets, writes code, fixes bugs, or reviews changes
6. **Shows their work** — streams every step to the Command Center in real time
7. **Asks for approval** — pauses at key checkpoints for PM review
8. **Ships it** — commits, pushes, and creates PRs upon approval

### Sandbox Isolation — Safe by Design

Every agent run happens inside a **Daytona sandbox** — an isolated cloud environment with:
- Its own filesystem (no access to production)
- Its own network (restricted by default)
- Its own branch (changes never touch main until approved)
- Automatic cleanup after the run

This means a PM can confidently tell an agent to "refactor the entire authentication module" without any risk of breaking production. The worst that happens is a rejected PR.

### Multi-Repo Intelligence — Feature Map

For features that span multiple repositories (backend API + frontend + SDK + infrastructure), Assembly Lime's **Feature Map** automatically identifies all affected repos:

1. PM describes a feature: "Add real-time notifications"
2. Agent searches the Feature Map for matching features
3. Agent retrieves all mapped repositories (backend, frontend, mobile SDK, infra)
4. Agent produces a plan **grouped by repository** with dependency-aware ordering
5. Shared libraries are updated before consumer repos

This eliminates the most painful part of multi-repo development: figuring out what needs to change where. The PM describes the feature once, and the system handles the coordination.

---

## Product-Led Development Workflows

### Workflow 1: Feature Planning (PM-Initiated)

```
PM: "We need to add team billing with per-seat pricing,
     Stripe integration, and an admin dashboard showing usage."

Agent (Plan mode):
  → Creates Epic: "Team Billing & Seat-Based Pricing"
  → Creates 5 Stories:
      1. Stripe subscription management (Backend)
      2. Per-seat pricing logic (Backend)
      3. Billing admin dashboard (Frontend)
      4. Usage tracking & reporting (Backend + Frontend)
      5. Billing email notifications (Backend)
  → Creates 18 Tasks across stories with:
      - Acceptance criteria
      - Owner role (PM/Dev/QA)
      - Priority (critical/high/medium/low)
      - Suggested board column

PM reviews the plan in the transcript → Approves
→ 18 tickets auto-populate the Kanban board
```

**Time:** ~3 minutes vs. 2–4 hours of traditional grooming.

### Workflow 2: Direct Implementation (PM-Driven)

```
PM: "Add a 'Copy invite link' button to the team settings page.
     It should generate a unique invite URL and copy it to clipboard
     with a toast notification."

Agent (Implement mode):
  → Identifies target repo (frontend)
  → Clones into sandbox, creates branch
  → Reads existing team settings page
  → Writes the component code
  → Adds clipboard API integration
  → Adds toast notification
  → Commits and pushes
  → Shows unified diff in transcript
  → Pauses: "Ready for review. Approve to create PR?"

PM reviews the diff → Approves
→ PR created on GitHub
→ Ticket moves to "Code Review"
```

**Time:** ~10 minutes vs. 1–2 sprint cycles.

### Workflow 3: Bug Triage & Fix (PM-Expedited)

```
PM: "Users are reporting that the dashboard takes 15+ seconds to load
     when they have more than 50 projects. This is P0."

Agent (Bugfix mode):
  → Clones repo, analyzes the dashboard data-fetching code
  → Identifies: N+1 query in project listing endpoint
  → Writes fix: batch query with pagination
  → Adds performance regression test
  → Shows diff + explanation:
      "Root cause: Each project triggered a separate DB query
       for its latest activity. Fixed by batching into a single
       query with a LEFT JOIN. Added a test that fails if the
       endpoint takes >500ms with 100 projects."
  → Pauses for approval

PM reviews → Approves → PR created
→ Ticket moves from "In Progress" to "Code Review"
```

**Time:** ~15 minutes vs. days of triage + scheduling + implementation.

### Workflow 4: Code Review (PM-Supervised)

```
PM: "Review the PR for the new onboarding flow before I merge it."

Agent (Review mode):
  → Reads the diff
  → Analyzes for:
      - Correctness (logic errors, edge cases)
      - Security (XSS, injection, auth bypass)
      - Performance (N+1 queries, unnecessary re-renders)
      - Style (naming conventions, code organization)
  → Outputs structured feedback:
      "3 issues found:
       1. [Security] User input not sanitized in line 47
       2. [Performance] useEffect missing dependency array —
          will re-run on every render
       3. [Style] Component exceeds 300 lines — suggest extracting
          the form validation into a custom hook"
```

The PM gets a second opinion on code quality without needing to read every line themselves.

---

## Testing Strategy — Quality the PM Can See and Trust

### The Testing Philosophy

In traditional development, testing is invisible to PMs. Developers write tests, CI pipelines run them, and the PM only hears about it when something breaks. Assembly Lime makes testing a **first-class, PM-visible activity** at every stage of the development lifecycle.

### How Testing Integrates into Each Agent Mode

#### Plan Mode — Testability by Design

When the planning agent breaks a feature into tickets, each ticket includes:
- **Acceptance criteria** — written as verifiable conditions, not vague descriptions
- **Owner role assignment** — QA-owned tickets are explicitly created for test planning
- **Test-relevant tasks** — the agent generates dedicated testing tasks (e.g., "Write integration tests for Stripe webhook handling")

Example output from a Plan run:
```
Story: Per-seat billing logic (Backend)
  Task 1: Implement seat count tracking         [Dev]   [P0]
  Task 2: Add Stripe subscription update API     [Dev]   [P0]
  Task 3: Write unit tests for seat calculations [QA]    [P0]
  Task 4: Write integration test for billing API [QA]    [P1]
  Task 5: Edge case: downgrade with active seats [QA]    [P1]
```

The PM sees testing work planned alongside implementation work — not as an afterthought.

#### Implement Mode — Tests Run Before You See the Diff

When an implementation agent completes its work, it runs the project's existing test suite inside the sandbox **before** presenting the diff to the PM. The transcript shows:

```
✓ Running existing test suite...
  148 tests passed
  0 tests failed
  2 new tests added (for the feature just implemented)
  Test run time: 12.4s

✓ All tests passing. Ready for review.
```

If tests fail, the agent attempts to fix the failures before presenting. If it cannot, the PM sees:

```
⚠ 2 tests failing after implementation:
  - test/billing.spec.ts:47 — "should calculate prorated amount"
  - test/billing.spec.ts:83 — "should handle currency conversion"

  Agent note: These failures appear to be related to a missing
  environment variable (STRIPE_TEST_KEY). The implementation
  logic is correct but cannot be verified without test credentials.
```

The PM can then provide the missing env vars via the secure input bar, or choose to proceed knowing the limitation.

#### Bugfix Mode — Regression Tests Are Mandatory

Every bugfix agent run produces:
1. **A regression test that fails without the fix** — proving the bug existed
2. **The fix itself** — the minimal code change
3. **The same regression test passing with the fix** — proving it's resolved

The PM sees this in the transcript as a clear before/after:

```
Regression test: "should load dashboard in <500ms with 100 projects"
  Without fix: FAIL (15,234ms)
  With fix:    PASS (312ms)
```

This gives the PM confidence that the specific bug is fixed and will be caught immediately if it ever regresses.

#### Review Mode — Test Coverage as a Review Criterion

The review agent evaluates code changes against five dimensions. Testing is explicitly one of them:

| Review Dimension | What the Agent Checks |
|-----------------|----------------------|
| Correctness | Logic errors, edge cases, off-by-one |
| Security | XSS, injection, auth bypass, secret exposure |
| Performance | N+1 queries, unnecessary re-renders, memory leaks |
| Style | Naming, structure, code organization |
| **Test Coverage** | Are new code paths tested? Are edge cases covered? Are existing tests still relevant? |

A review output might include:
```
Test Coverage Assessment:
  - New function `calculateProration()` has 0 test coverage [HIGH]
  - Edge case: negative seat count not tested [MEDIUM]
  - Existing test for `updateSubscription()` should be updated
    to cover the new proration parameter [LOW]
```

### The QA Column — PM's Testing Dashboard

The Kanban board's **QA column** serves as the PM's testing visibility layer:

```
Backlog → Todo → In Progress → Code Review → QA → Done
                                               ↑
                                          PM's testing
                                          checkpoint
```

**What lands in QA:**
- Tickets where implementation is complete and PR is approved, pending verification
- Agent-generated QA tasks from Plan mode
- Tickets flagged by Review agent as needing additional testing

**What the PM sees on QA cards:**
- Test pass/fail status badge
- Number of regression tests added
- Link to preview deployment for manual verification
- Assignee (QA team member or "Awaiting QA")

**PM actions from QA column:**
- Move to Done — verification complete, ship it
- Move back to In Progress — found an issue, needs rework
- Trigger a Review agent run — get AI verification before manual QA

### Preview Deployments — See It Before You Ship It

Every implementation and bugfix run can produce a **live preview deployment** in the Daytona sandbox. The PM sees:

```
Preview available:
  Branch: al/implement/run-1847
  URL: https://preview-1847.sandbox.daytona.io
  Status: Running
```

This lets the PM verify changes visually — click through the UI, test the flow, check responsive behavior — before approving the PR. No waiting for staging deployments or "can you deploy this to dev so I can test?"

### Test Reporting in Agent Runs Dashboard

The Agent Runs history page shows test outcomes per run:

| Run ID | Mode | Status | Tests |
|--------|------|--------|-------|
| #1847 | Implement | Completed | 148 passed, 2 added |
| #1846 | Bugfix | Completed | 147 passed, 1 regression added |
| #1845 | Review | Completed | 3 coverage gaps identified |
| #1844 | Plan | Approved | 6 QA tasks created |

Over time, this creates a **testing audit trail** — the PM can show stakeholders exactly how many tests were added, how many bugs were caught by regression tests, and how test coverage trended across runs.

### Testing Workflows for PMs

#### Workflow: "Is this feature safe to ship?"

```
PM: "Run a review on the billing feature PR and check test coverage."

Agent (Review mode):
  → Reads the diff (347 lines across 8 files)
  → Identifies 4 new functions without tests
  → Identifies 2 edge cases not covered
  → Checks that all existing tests still pass
  → Produces report:

      "Test coverage for this PR: 72% of new code paths covered.
       Recommendations:
       1. Add unit test for `calculateProration()` — handles money
       2. Add test for seat count = 0 edge case
       3. Add integration test for Stripe webhook → DB update flow
       4. Existing tests pass — no regressions detected."
```

The PM now knows exactly what testing gaps exist before merging.

#### Workflow: "A bug was fixed — prove it won't come back"

```
PM: "Fix the dashboard loading issue and make sure it stays fixed."

Agent (Bugfix mode):
  → Writes regression test FIRST (test-driven fix)
  → Regression test fails (confirms the bug)
  → Writes the fix
  → Regression test passes (confirms the fix works)
  → Runs full test suite (confirms nothing else broke)
  → Presents:

      "Fix: Replaced N+1 query with batched JOIN (3 lines changed)
       Regression test: 'dashboard loads <500ms with 100 projects'
       Full suite: 149/149 passing (was 148 — 1 new test added)"
```

The PM has mathematical proof the bug is fixed and will be caught automatically if it returns.

---

## Instruction Hierarchy — PM Control at Every Level

Assembly Lime gives PMs granular control over how agents behave through a layered instruction system:

| Level | Scope | Example |
|-------|-------|---------|
| **Tenant** | All projects, all agents | "Always use TypeScript strict mode. Never use `any` type." |
| **Project** | All repos in a project | "This is a healthcare app — ensure HIPAA compliance in all data handling." |
| **Repository** | Single repo | "This repo uses Tailwind CSS. Do not install styled-components." |
| **Ticket** | Single ticket/run | "The design mockup is attached. Match it pixel-perfect." |
| **Prompt** | Single agent run | The PM's natural-language request |

Instructions resolve top-down. A PM sets project-level guardrails once, and every agent run inherits them automatically. This means consistent output quality without repeating yourself.

---

## Multi-Tenant Architecture — Built for Teams

Assembly Lime is multi-tenant from the ground up:

- **Tenant isolation** — every row in the database is scoped to a tenant. No data leakage between organizations.
- **Role-based access** — PM, Developer, QA roles with different permissions (schema defined, enforcement in progress)
- **Project-level context** — switching projects changes everything: board, repos, agent history, instructions
- **Shared connectors** — GitHub connectors are tenant-wide, so the whole team benefits from a single setup

---

## Security Model

### For PMs Who Need to Assure Stakeholders

| Concern | How Assembly Lime Handles It |
|---------|------------------------------|
| "Can the AI access production?" | No. Every agent runs in an isolated Daytona sandbox with no access to production systems |
| "Can the AI push directly to main?" | No. Agents create feature branches. PRs require explicit PM approval |
| "Are our secrets safe?" | Yes. Secrets are encrypted at rest (AES-256-GCM) with envelope encryption. Agents never see raw secrets in prompts |
| "Is there an audit trail?" | Yes. Every agent action is logged as a structured event — fully replayable |
| "What about cost control?" | Budget enforcement per project is built into the schema (dashboard in progress) |
| "Who approved this change?" | Every approval/rejection is tied to a user and timestamp |

---

## Key Metrics for PM Adoption

### Leading Indicators

| Metric | Definition | Target |
|--------|-----------|--------|
| **Time to First Run** | Time from PM signup to first agent run | < 10 minutes |
| **Plan-to-Board Rate** | % of Plan runs that result in approved board tickets | > 80% |
| **Approval Rate** | % of Implement runs approved on first attempt | > 70% |
| **Iteration Depth** | Average follow-up messages per run before approval | < 3 |
| **PM Runs per Week** | Agent runs initiated by PMs (not devs) | Growing week-over-week |

### Lagging Indicators

| Metric | Definition | Target |
|--------|-----------|--------|
| **Cycle Time** | Median time from feature request to merged PR | < 1 day |
| **Ticket Throughput** | Tickets moved to Done per week per project | 3x baseline |
| **Grooming Time Saved** | Reduction in sprint planning/grooming hours | > 60% |
| **Context Switch Reduction** | Fewer tools needed in PM daily workflow | Dashboard + GitHub only |

---

## Competitive Positioning

### Where Assembly Lime Sits

```
                        PM-First ←————————————→ Dev-First
                            |                       |
              Assembly Lime ●                       |
                            |                       |
           Linear + AI ○    |          ○ Cursor     |
                            |                       |
   Jira + Copilot ○        |     ○ GitHub Copilot  |
      (stitched)            |       Workspace       |
                            |                       |
                            |              ○ Devin  |
                            |                       |
                    Low AI Agency ————————→ High AI Agency
```

| Tool | Who Drives | AI Capability | Deployment? |
|------|-----------|--------------|-------------|
| **Jira + GitHub Copilot** | Dev (PM writes specs separately) | Code completion only | No |
| **Linear** | PM + Dev | Triage suggestions | No |
| **Cursor / Windsurf** | Dev only | Code generation in IDE | No |
| **Devin** | Dev (PM not in the loop) | Full agent, but dev-facing | No |
| **GitHub Copilot Workspace** | Dev | Spec → code, but dev-initiated | No |
| **Assembly Lime** | **PM-first** | Plan + Implement + Review + Bugfix | **Yes (preview + deploy)** |

### Assembly Lime's Differentiation

1. **PM is the driver** — not a passenger reading dashboards while devs do the work
2. **End-to-end lifecycle** — from natural language to deployed code, in one tool
3. **Human-in-the-loop by design** — AI proposes, PM disposes. No runaway agents
4. **Multi-repo awareness** — Feature Map coordinates changes across backend, frontend, SDK, and infra
5. **Full audit trail** — every decision, every line of code, every approval is recorded and replayable
6. **Integrated board** — tickets, code, PRs, and deployments in one place (not Jira + GitHub + Vercel + Slack)

---

## Roadmap (PM-Relevant Milestones)

### Now (Shipped)

- Command Center with streaming agent transcript
- Four agent modes: Plan, Implement, Bugfix, Review
- Kanban board with drag-and-drop and AI-generated tickets
- Human-in-the-loop approval gates
- GitHub connector and repository management
- Real-time WebSocket updates
- Sandbox isolation for all agent runs
- Agent run history and replay
- Repository file browser and dependency graph
- Preview deployments in sandboxes

### Next (In Progress)

- **One-click PR creation** — PM approves → PR created automatically with linked tickets
- **Cost tracking dashboard** — see per-run and per-project AI spend
- **Ticket drawer actions** — "Ask AI / Implement / Review" buttons directly on Kanban cards
- **Agent chains** — multi-step pipelines (Plan → Implement → Review → Bugfix) that run automatically with approval gates between steps

### Later (Planned)

- **Feature Map management UI** — PMs define which repos serve which features
- **Multi-repo orchestration** — single agent run coordinates changes across all affected repos
- **Deployment pipeline integration** — GitHub Actions visibility, one-click deploys
- **Budget enforcement** — per-project spending limits with alerts
- **Role-based access control** — PM/Dev/QA permissions enforced in the UI
- **Agent memory** — context persistence across runs so agents learn project patterns

### Future (Vision)

- **Natural language deployment** — "Deploy the billing feature to staging" triggers the full pipeline
- **Regression detection** — agents monitor production metrics post-deploy and auto-create bugfix runs
- **Stakeholder reports** — auto-generated weekly progress reports from board activity and agent runs
- **Custom agent skills** — PMs define reusable agent behaviors ("always run our linter before committing")
- **Cross-project insights** — identify patterns across projects (common bugs, reusable components)

---

## Getting Started (PM Quick Start)

### Step 1: Connect GitHub
Navigate to **Connectors** → Add a GitHub connector with your org's access token → Sync repositories.

### Step 2: Create a Project
Create a project and link the relevant repositories to it.

### Step 3: Describe Your First Feature
Go to **Command Center** → Select **Plan** mode → Type:
> "Create a user onboarding flow with email verification, profile setup, and a welcome tutorial."

Watch the agent break it into structured tickets on your board.

### Step 4: Start Building
Pick a ticket → Click back to Command Center → Select **Implement** mode → Reference the ticket → Watch the agent write the code.

### Step 5: Review and Approve
Read the diff in the transcript. If it looks good, approve. A PR is created on GitHub. If it needs changes, type follow-up instructions and the agent iterates.

---

## Summary

Assembly Lime is not a tool for developers that PMs can also use. It is a **tool for PMs that developers benefit from**. It inverts the traditional hierarchy where PMs are dependent on engineering capacity and sprint schedules.

With AI agents that can plan, implement, fix, and review code, the constraint shifts from "how many engineers do we have?" to "how clearly can we describe what we want?" Assembly Lime gives PMs the answer to that question — and the tools to act on it immediately.

**The PM who can describe it can ship it.**

---

*Assembly Lime — Product Led AI-Native Development and Deployment*
*Built by Aikaara*
