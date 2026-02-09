import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Ticket } from "../../types";
import { Badge } from "../ui/Badge";
import { GitBranch, GitPullRequest } from "lucide-react";

const PRIORITY_BORDER: Record<Ticket["priority"], string> = {
  critical: "border-l-red-500",
  high: "border-l-amber-500",
  medium: "border-l-blue-500",
  low: "border-l-zinc-600",
};

export function KanbanCard({
  ticket,
  onClick,
}: {
  ticket: Ticket;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: ticket.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`rounded-lg border border-zinc-800 border-l-2 ${PRIORITY_BORDER[ticket.priority]} bg-zinc-900 p-3 cursor-pointer hover:bg-zinc-800/80 transition-colors ${
        isDragging ? "opacity-50 shadow-xl" : ""
      }`}
    >
      <p className="text-sm text-zinc-200 font-medium line-clamp-2">
        {ticket.title}
      </p>

      {ticket.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {ticket.labels.map((label) => (
            <Badge key={label} variant="neutral">
              {label}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        {ticket.branch && (
          <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
            <GitBranch className="h-3 w-3" />
            <span className="truncate max-w-24">{ticket.branch}</span>
          </span>
        )}
        {ticket.prUrl && (
          <GitPullRequest className="h-3.5 w-3.5 text-emerald-500" />
        )}
        <div className="flex-1" />
        {ticket.assignee && (
          <div className="h-5 w-5 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] text-zinc-300">
            {ticket.assignee}
          </div>
        )}
      </div>
    </div>
  );
}
