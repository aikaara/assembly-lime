import type { AgentEvent } from "../../types";
import { Badge } from "../ui/Badge";
import { DiffViewer } from "../ui/DiffViewer";
import { StatusDot } from "../ui/StatusDot";
import {
  MessageSquare,
  ScrollText,
  FileCode,
  Package,
  AlertTriangle,
  Globe,
  Monitor,
  User,
} from "lucide-react";

export function EventCard({ event }: { event: AgentEvent }) {
  switch (event.type) {
    case "message":
      return (
        <div className="flex gap-3 py-2">
          <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-zinc-500" />
          <div className="min-w-0 flex-1">
            <span className="text-xs text-zinc-500 mb-1 block">
              {event.role}
            </span>
            <p className="text-sm text-zinc-200 whitespace-pre-wrap break-words">
              {event.text}
            </p>
          </div>
        </div>
      );

    case "log":
      return (
        <div className="flex gap-3 py-2">
          <ScrollText className="h-4 w-4 mt-0.5 shrink-0 text-zinc-600" />
          <pre className="text-xs text-zinc-500 font-mono whitespace-pre-wrap break-all">
            {event.text}
          </pre>
        </div>
      );

    case "diff":
      return (
        <div className="py-2">
          <div className="flex items-center gap-2 mb-2">
            <FileCode className="h-4 w-4 text-blue-400" />
            <span className="text-xs text-zinc-400">Code Diff</span>
          </div>
          <DiffViewer diff={event.unifiedDiff} summary={event.summary} />
        </div>
      );

    case "artifact":
      return (
        <div className="flex gap-3 py-2">
          <Package className="h-4 w-4 mt-0.5 shrink-0 text-purple-400" />
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
            <span className="text-zinc-200">{event.name}</span>
            {event.url && (
              <a
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-emerald-400 hover:text-emerald-300 text-xs"
              >
                Open
              </a>
            )}
            {event.mime && (
              <Badge variant="neutral">{event.mime}</Badge>
            )}
          </div>
        </div>
      );

    case "error":
      return (
        <div className="flex gap-3 py-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-400" />
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 min-w-0 flex-1">
            <p className="text-sm text-red-400 break-words">{event.message}</p>
            {event.stack && (
              <pre className="mt-2 text-xs text-red-500/70 font-mono whitespace-pre-wrap break-all">
                {event.stack}
              </pre>
            )}
          </div>
        </div>
      );

    case "status":
      return (
        <div className="flex items-center gap-2 py-2">
          <StatusDot status={event.status} />
          <Badge
            variant={
              event.status === "completed" || event.status === "plan_approved"
                ? "success"
                : event.status === "failed"
                  ? "error"
                  : event.status === "running"
                    ? "info"
                    : event.status === "awaiting_approval"
                      ? "warning"
                      : event.status === "awaiting_followup"
                        ? "success"
                        : "neutral"
            }
          >
            {event.status}
          </Badge>
          {event.message && (
            <span className="text-xs text-zinc-400">{event.message}</span>
          )}
        </div>
      );

    case "sandbox":
      return (
        <div className="flex gap-3 py-2">
          <Monitor className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="warning">sandbox</Badge>
              <Badge variant="neutral">{event.provider}</Badge>
            </div>
            <a
              href={event.sandboxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-amber-400 hover:text-amber-300 text-xs font-mono truncate"
            >
              {event.sandboxUrl}
            </a>
            <p className="text-xs text-zinc-500 mt-1">
              Open to watch the agent make changes in real-time
            </p>
          </div>
        </div>
      );

    case "preview":
      return (
        <div className="flex gap-3 py-2">
          <Globe className="h-4 w-4 mt-0.5 shrink-0 text-cyan-400" />
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="cyan">preview</Badge>
              <Badge variant="neutral">{event.branch}</Badge>
              <Badge
                variant={
                  event.status === "active"
                    ? "success"
                    : event.status === "failed"
                      ? "error"
                      : "info"
                }
              >
                {event.status}
              </Badge>
            </div>
            {event.previewUrl && event.status === "active" && (
              <a
                href={event.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block text-emerald-400 hover:text-emerald-300 text-xs truncate"
              >
                {event.previewUrl}
              </a>
            )}
          </div>
        </div>
      );

    case "user_message":
      return (
        <div className="flex gap-3 py-2 justify-end">
          <div className="max-w-[80%] rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2">
            <span className="text-xs text-emerald-500 mb-1 block">You</span>
            <p className="text-sm text-zinc-200 whitespace-pre-wrap break-words">
              {event.text}
            </p>
          </div>
          <User className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />
        </div>
      );

    case "tasks":
      // Rendered by TaskProgressWidget, not inline
      return null;
  }
}
