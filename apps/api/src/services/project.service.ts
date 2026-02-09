import { eq, and, asc } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import {
  projects,
  boards,
  tickets,
} from "@assembly-lime/shared/db/schema";

const DEFAULT_COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "Todo" },
  { key: "in_progress", label: "In Progress" },
  { key: "code_review", label: "Code Review" },
  { key: "qa", label: "QA" },
  { key: "done", label: "Done" },
];

export async function listProjects(db: Db, tenantId: number) {
  return db.query.projects.findMany({
    where: (p, { eq }) => eq(p.tenantId, tenantId),
    orderBy: (p, { asc }) => asc(p.createdAt),
  });
}

export async function getProject(db: Db, tenantId: number, projectId: number) {
  return db.query.projects.findFirst({
    where: (p, { and, eq }) =>
      and(eq(p.tenantId, tenantId), eq(p.id, projectId)),
  });
}

export async function createProject(
  db: Db,
  tenantId: number,
  input: { name: string; key: string },
) {
  const [project] = await db
    .insert(projects)
    .values({ tenantId, name: input.name, key: input.key.toUpperCase() })
    .returning();

  // Auto-create default board
  await db.insert(boards).values({
    tenantId,
    projectId: project!.id,
    name: "Main Board",
    columnsJson: DEFAULT_COLUMNS,
  });

  return project!;
}

export async function getBoard(db: Db, tenantId: number, projectId: number) {
  const board = await db.query.boards.findFirst({
    where: (b, { and, eq }) =>
      and(eq(b.tenantId, tenantId), eq(b.projectId, projectId)),
  });

  if (!board) return null;

  const boardTickets = await db
    .select()
    .from(tickets)
    .where(
      and(eq(tickets.tenantId, tenantId), eq(tickets.boardId, board.id)),
    )
    .orderBy(asc(tickets.createdAt));

  return {
    board: {
      id: String(board.id),
      name: board.name,
      columns: board.columnsJson,
    },
    tickets: boardTickets.map(formatTicket),
  };
}

export async function createTicket(
  db: Db,
  tenantId: number,
  projectId: number,
  input: {
    title: string;
    descriptionMd?: string;
    columnKey?: string;
    priority?: number;
    labelsJson?: string[];
  },
  createdBy?: number,
) {
  // Find the board for this project
  const board = await db.query.boards.findFirst({
    where: (b, { and, eq }) =>
      and(eq(b.tenantId, tenantId), eq(b.projectId, projectId)),
  });

  if (!board) throw new Error("No board found for this project");

  const [ticket] = await db
    .insert(tickets)
    .values({
      tenantId,
      projectId,
      boardId: board.id,
      columnKey: input.columnKey ?? "backlog",
      title: input.title,
      descriptionMd: input.descriptionMd,
      priority: input.priority ?? 2,
      labelsJson: input.labelsJson ?? [],
      createdBy,
    })
    .returning();

  return formatTicket(ticket!);
}

export async function updateTicket(
  db: Db,
  tenantId: number,
  ticketId: number,
  partial: {
    title?: string;
    descriptionMd?: string;
    columnKey?: string;
    priority?: number;
    labelsJson?: string[];
    branch?: string;
    prUrl?: string;
    assigneeUserId?: number;
  },
) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (partial.title !== undefined) updates.title = partial.title;
  if (partial.descriptionMd !== undefined)
    updates.descriptionMd = partial.descriptionMd;
  if (partial.columnKey !== undefined) updates.columnKey = partial.columnKey;
  if (partial.priority !== undefined) updates.priority = partial.priority;
  if (partial.labelsJson !== undefined) updates.labelsJson = partial.labelsJson;
  if (partial.branch !== undefined) updates.branch = partial.branch;
  if (partial.prUrl !== undefined) updates.prUrl = partial.prUrl;
  if (partial.assigneeUserId !== undefined)
    updates.assigneeUserId = partial.assigneeUserId;

  const [ticket] = await db
    .update(tickets)
    .set(updates)
    .where(and(eq(tickets.tenantId, tenantId), eq(tickets.id, ticketId)))
    .returning();

  if (!ticket) return null;
  return formatTicket(ticket);
}

export async function getTicket(db: Db, tenantId: number, ticketId: number) {
  const ticket = await db.query.tickets.findFirst({
    where: (t, { and, eq }) =>
      and(eq(t.tenantId, tenantId), eq(t.id, ticketId)),
  });
  if (!ticket) return null;
  return formatTicket(ticket);
}

function formatTicket(t: typeof tickets.$inferSelect) {
  return {
    id: String(t.id),
    title: t.title,
    description: t.descriptionMd ?? "",
    column: t.columnKey,
    priority: priorityLabel(t.priority ?? 2),
    labels: (t.labelsJson as string[]) ?? [],
    branch: t.branch ?? undefined,
    prUrl: t.prUrl ?? undefined,
    assignee: t.assigneeUserId ? String(t.assigneeUserId) : undefined,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function priorityLabel(p: number): string {
  switch (p) {
    case 0:
      return "low";
    case 1:
      return "medium";
    case 2:
      return "medium";
    case 3:
      return "high";
    case 4:
      return "critical";
    default:
      return "medium";
  }
}
