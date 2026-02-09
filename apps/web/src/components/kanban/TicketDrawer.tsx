import * as Dialog from "@radix-ui/react-dialog";
import { X, GitBranch, GitPullRequest } from "lucide-react";
import type { Ticket } from "../../types";
import { COLUMNS } from "../../types";
import { Badge } from "../ui/Badge";

const PRIORITY_VARIANT = {
  critical: "error",
  high: "warning",
  medium: "info",
  low: "neutral",
} as const;

export function TicketDrawer({
  ticket,
  open,
  onOpenChange,
}: {
  ticket: Ticket | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!ticket) return null;

  const col = COLUMNS[ticket.column];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-zinc-900 border-l border-zinc-800 shadow-xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-zinc-800 px-6 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-semibold text-zinc-100 pr-4">
                {ticket.title}
              </Dialog.Title>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="neutral">{col.label}</Badge>
                <Badge variant={PRIORITY_VARIANT[ticket.priority]}>
                  {ticket.priority}
                </Badge>
              </div>
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {/* Labels */}
            {ticket.labels.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                  Labels
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {ticket.labels.map((label) => (
                    <Badge key={label} variant="neutral">
                      {label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            <div>
              <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                Description
              </h3>
              <p className="text-sm text-zinc-300 whitespace-pre-wrap">
                {ticket.description}
              </p>
            </div>

            {/* Branch & PR */}
            {(ticket.branch || ticket.prUrl) && (
              <div>
                <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                  Development
                </h3>
                <div className="space-y-2">
                  {ticket.branch && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <GitBranch className="h-4 w-4" />
                      <code className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                        {ticket.branch}
                      </code>
                    </div>
                  )}
                  {ticket.prUrl && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <GitPullRequest className="h-4 w-4 text-emerald-500" />
                      <a
                        href={ticket.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:text-emerald-300 text-xs"
                      >
                        View Pull Request
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Assignee */}
            {ticket.assignee && (
              <div>
                <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                  Assignee
                </h3>
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs text-zinc-300">
                    {ticket.assignee}
                  </div>
                  <span className="text-sm text-zinc-300">
                    User {ticket.assignee}
                  </span>
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
