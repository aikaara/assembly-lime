import { useState, useRef, useEffect } from "react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { Plus, X } from "lucide-react";
import type { Ticket, ColumnKey } from "../../types";
import { COLUMNS } from "../../types";
import { KanbanCard } from "./KanbanCard";

export function KanbanColumn({
  columnKey,
  tickets,
  onCardClick,
  onAddTicket,
}: {
  columnKey: ColumnKey;
  tickets: Ticket[];
  onCardClick: (ticket: Ticket) => void;
  onAddTicket?: (columnKey: ColumnKey, title: string) => void;
}) {
  const column = COLUMNS[columnKey];
  const { setNodeRef } = useDroppable({ id: columnKey });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed || !onAddTicket) return;
    onAddTicket(columnKey, trimmed);
    setTitle("");
    setAdding(false);
  }

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="flex items-center gap-2 px-2 pb-3">
        <span className={`h-2.5 w-2.5 rounded-full ${column.color}`} />
        <span className="text-sm font-medium text-zinc-300">
          {column.label}
        </span>
        <span className="ml-auto text-xs text-zinc-500">{tickets.length}</span>
        {onAddTicket && (
          <button
            onClick={() => setAdding(true)}
            className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
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

          {adding && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-2">
              <input
                ref={inputRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setTitle("");
                  }
                }}
                placeholder="Ticket title..."
                className="w-full rounded bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:ring-1 focus:ring-lime-500/50"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={handleSubmit}
                  className="rounded bg-lime-500 px-3 py-1 text-xs font-medium text-zinc-950 transition-colors hover:bg-lime-400"
                >
                  Add
                </button>
                <button
                  onClick={() => {
                    setAdding(false);
                    setTitle("");
                  }}
                  className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}
