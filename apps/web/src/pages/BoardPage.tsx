import { useState, useEffect, useMemo } from "react";
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import type { Ticket, ColumnKey, BoardResponse } from "../types";
import { COLUMN_KEYS } from "../types";
import { useKanbanState } from "../hooks/useKanbanState";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import { KanbanColumn } from "../components/kanban/KanbanColumn";
import { TicketDrawer } from "../components/kanban/TicketDrawer";

function apiTicketsToTickets(apiTickets: BoardResponse["tickets"]): Ticket[] {
  return apiTickets.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    column: t.column as ColumnKey,
    priority: t.priority as Ticket["priority"],
    labels: t.labels,
    branch: t.branch,
    prUrl: t.prUrl,
    assignee: t.assignee,
  }));
}

export function BoardPage() {
  const auth = useAuth();
  const projectId =
    auth.status === "authenticated" ? auth.currentProjectId : null;

  const [boardData, setBoardData] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api
      .get<BoardResponse>(`/projects/${projectId}/board`)
      .then(setBoardData)
      .catch((err) => console.error("Failed to load board:", err))
      .finally(() => setLoading(false));
  }, [projectId]);

  const initialTickets = useMemo(
    () => (boardData ? apiTicketsToTickets(boardData.tickets) : []),
    [boardData],
  );

  const { ticketsByColumn, dispatch } = useKanbanState(initialTickets);
  const [drawerTicket, setDrawerTicket] = useState<Ticket | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const ticketId = active.id as string;

    let targetColumn: ColumnKey | undefined;

    if (COLUMN_KEYS.includes(over.id as ColumnKey)) {
      targetColumn = over.id as ColumnKey;
    } else {
      for (const key of COLUMN_KEYS) {
        if (ticketsByColumn[key].some((t) => t.id === over.id)) {
          targetColumn = key;
          break;
        }
      }
    }

    if (!targetColumn) return;

    dispatch({
      type: "MOVE_TICKET",
      ticketId,
      toColumn: targetColumn,
      toIndex: 0,
    });

    // Persist the column move
    api
      .patch(`/tickets/${ticketId}`, { columnKey: targetColumn })
      .catch((err) => console.error("Failed to update ticket:", err));
  }

  function openDrawer(ticket: Ticket) {
    setDrawerTicket(ticket);
    setDrawerOpen(true);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-400" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-x-auto p-6">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 h-full">
          {COLUMN_KEYS.map((key) => (
            <KanbanColumn
              key={key}
              columnKey={key}
              tickets={ticketsByColumn[key]}
              onCardClick={openDrawer}
            />
          ))}
        </div>
      </DndContext>

      <TicketDrawer
        ticket={drawerTicket}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
