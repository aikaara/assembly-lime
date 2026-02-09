import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import type { Ticket, ColumnKey } from "../../types";
import { COLUMNS } from "../../types";
import { KanbanCard } from "./KanbanCard";

export function KanbanColumn({
  columnKey,
  tickets,
  onCardClick,
}: {
  columnKey: ColumnKey;
  tickets: Ticket[];
  onCardClick: (ticket: Ticket) => void;
}) {
  const column = COLUMNS[columnKey];
  const { setNodeRef } = useDroppable({ id: columnKey });

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="flex items-center gap-2 px-2 pb-3">
        <span className={`h-2.5 w-2.5 rounded-full ${column.color}`} />
        <span className="text-sm font-medium text-zinc-300">
          {column.label}
        </span>
        <span className="ml-auto text-xs text-zinc-500">{tickets.length}</span>
      </div>

      <SortableContext
        items={tickets.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className="flex flex-1 flex-col gap-2 rounded-lg bg-zinc-900/30 p-2 min-h-32"
        >
          {tickets.map((ticket) => (
            <KanbanCard
              key={ticket.id}
              ticket={ticket}
              onClick={() => onCardClick(ticket)}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
