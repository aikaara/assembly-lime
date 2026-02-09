import type { Ticket } from "../types";

export const MOCK_TICKETS: Ticket[] = [
  {
    id: "t-1",
    title: "Set up GitHub OAuth integration",
    description:
      "Implement GitHub OAuth flow for user authentication. Should create tenant and assign admin role on first login.",
    column: "done",
    priority: "high",
    labels: ["auth", "backend"],
    branch: "feat/github-oauth",
    prUrl: "#",
    assignee: "A",
  },
  {
    id: "t-2",
    title: "Design database schema for multi-tenant boards",
    description:
      "Create Drizzle ORM schema for boards, tickets, and columns with proper tenant scoping.",
    column: "done",
    priority: "high",
    labels: ["database", "schema"],
    assignee: "B",
  },
  {
    id: "t-3",
    title: "Build ticket CRUD API endpoints",
    description:
      "REST endpoints for creating, reading, updating, and deleting tickets with proper validation.",
    column: "in_progress",
    priority: "high",
    labels: ["api", "backend"],
    branch: "feat/ticket-crud",
    assignee: "A",
  },
  {
    id: "t-4",
    title: "Implement WebSocket real-time ticket updates",
    description:
      "Broadcast ticket changes via WebSocket so board updates are reflected instantly for all connected users.",
    column: "todo",
    priority: "medium",
    labels: ["realtime", "backend"],
  },
  {
    id: "t-5",
    title: "Add drag-and-drop to Kanban board",
    description:
      "Use @dnd-kit to enable drag and drop for moving tickets between columns and reordering within columns.",
    column: "code_review",
    priority: "medium",
    labels: ["frontend", "ux"],
    branch: "feat/kanban-dnd",
    prUrl: "#",
    assignee: "C",
  },
  {
    id: "t-6",
    title: "Create agent run budget enforcement",
    description:
      "Check project budget before starting agent runs. Reject runs that would exceed the budget limit.",
    column: "backlog",
    priority: "medium",
    labels: ["backend", "agents"],
  },
  {
    id: "t-7",
    title: "Add code diff viewer component",
    description:
      "React component that renders unified diffs with syntax highlighting, line numbers, and expandable hunks.",
    column: "qa",
    priority: "low",
    labels: ["frontend", "ui"],
    branch: "feat/diff-viewer",
    assignee: "C",
  },
  {
    id: "t-8",
    title: "Set up CI/CD pipeline with GitHub Actions",
    description:
      "Configure GitHub Actions for linting, type checking, testing, and deployment on push to main.",
    column: "backlog",
    priority: "low",
    labels: ["devops", "ci"],
  },
  {
    id: "t-9",
    title: "Implement feature map search with pg_trgm",
    description:
      "Full-text search across features, aliases, and repository mappings using PostgreSQL trigram indexes.",
    column: "todo",
    priority: "high",
    labels: ["database", "search"],
  },
  {
    id: "t-10",
    title: "Hook sandbox execution environment",
    description:
      "Run user-defined hooks in isolated containers with no host filesystem or network access by default.",
    column: "backlog",
    priority: "critical",
    labels: ["security", "agents"],
  },
];
