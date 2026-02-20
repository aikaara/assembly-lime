import type { AgentEvent, AgentRunStatus } from "../../types";
import type { EventGroup } from "../../hooks/useEventGroups";
import { Badge } from "../ui/Badge";
import { DiffViewer } from "../ui/DiffViewer";
import { StatusDot } from "../ui/StatusDot";
import { CollapsibleSection } from "./CollapsibleSection";
import { MarkdownContent } from "./MarkdownContent";
import {
  AlertTriangle,
  Package,
  Globe,
  Monitor,
  Wrench,
  ScrollText,
  ListChecks,
} from "lucide-react";

function statusBadgeVariant(
  status: AgentRunStatus,
): "success" | "error" | "info" | "warning" | "neutral" {
  if (status === "completed" || status === "plan_approved") return "success";
  if (status === "failed") return "error";
  if (status === "running") return "info";
  if (status === "awaiting_approval") return "warning";
  if (status === "awaiting_followup") return "success";
  return "neutral";
}

export function EventGroupCard({ group }: { group: EventGroup }) {
  switch (group.kind) {
    // ── User prompts: right-aligned emerald bubble ──
    case "initial_prompt":
    case "user_message": {
      const text = (
        group.events[0] as Extract<AgentEvent, { type: "user_message" }>
      ).text;
      return (
        <div className="flex justify-end py-1">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-emerald-600/20 border border-emerald-700/40 px-4 py-2.5">
            <p className="text-sm text-zinc-200 whitespace-pre-wrap break-words leading-relaxed">
              {text}
            </p>
          </div>
        </div>
      );
    }

    // ── Assistant messages: left-aligned markdown ──
    case "assistant_message": {
      const combined = group.events
        .map((e) => (e as Extract<AgentEvent, { type: "message" }>).text)
        .join("\n\n");
      return (
        <div className="py-1">
          <div className="max-w-full">
            <MarkdownContent text={combined} />
          </div>
        </div>
      );
    }

    // ── Tool messages: collapsible ──
    case "tool_messages": {
      const count = group.events.length;
      return (
        <div className="py-1">
          <CollapsibleSection
            label={`${count} tool call${count !== 1 ? "s" : ""}`}
            badge={
              <Wrench className="h-3 w-3 text-zinc-500" />
            }
          >
            <div className="ml-5 mt-1 space-y-1 border-l border-zinc-800 pl-3">
              {group.events.map((event, i) => (
                <pre
                  key={i}
                  className="text-xs text-zinc-500 font-mono whitespace-pre-wrap break-all"
                >
                  {(event as Extract<AgentEvent, { type: "message" }>).text}
                </pre>
              ))}
            </div>
          </CollapsibleSection>
        </div>
      );
    }

    // ── Log group: collapsed by default ──
    case "log_group": {
      const count = group.events.length;
      return (
        <div className="py-1">
          <CollapsibleSection
            label={`Agent working... (${count} log${count !== 1 ? "s" : ""})`}
            badge={
              <ScrollText className="h-3 w-3 text-zinc-500" />
            }
          >
            <div className="ml-5 mt-1 space-y-0.5 border-l border-zinc-800 pl-3">
              {group.events.map((event, i) => {
                const text =
                  event.type === "log"
                    ? event.text
                    : (event as Extract<AgentEvent, { type: "message" }>).text;
                return (
                  <pre
                    key={i}
                    className="text-xs text-zinc-600 font-mono whitespace-pre-wrap break-all"
                  >
                    {text}
                  </pre>
                );
              })}
            </div>
          </CollapsibleSection>
        </div>
      );
    }

    // ── Status: centered divider ──
    case "status": {
      const event = group.events[0] as Extract<
        AgentEvent,
        { type: "status" }
      >;
      return (
        <div className="flex items-center gap-3 py-2">
          <div className="flex-1 h-px bg-zinc-800" />
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusDot status={event.status} />
            <Badge variant={statusBadgeVariant(event.status)}>
              {event.status.replace(/_/g, " ")}
            </Badge>
            {event.message && (
              <span className="text-xs text-zinc-500">{event.message}</span>
            )}
          </div>
          <div className="flex-1 h-px bg-zinc-800" />
        </div>
      );
    }

    // ── Diff: collapsible wrapper ──
    case "diff": {
      const event = group.events[0] as Extract<AgentEvent, { type: "diff" }>;
      return (
        <div className="py-1">
          <CollapsibleSection
            label={event.summary ?? "Code changes"}
            defaultOpen
          >
            <div className="mt-1">
              <DiffViewer diff={event.unifiedDiff} summary={event.summary} />
            </div>
          </CollapsibleSection>
        </div>
      );
    }

    // ── Error: red card with collapsible stack ──
    case "error": {
      const event = group.events[0] as Extract<
        AgentEvent,
        { type: "error" }
      >;
      return (
        <div className="py-1">
          <div className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-400" />
              <p className="text-sm text-red-400 break-words flex-1">
                {event.message}
              </p>
            </div>
            {event.stack && (
              <CollapsibleSection label="Stack trace">
                <pre className="ml-6 mt-1 text-xs text-red-500/60 font-mono whitespace-pre-wrap break-all">
                  {event.stack}
                </pre>
              </CollapsibleSection>
            )}
          </div>
        </div>
      );
    }

    // ── Tasks: collapsible numbered list ──
    case "tasks": {
      const event = group.events[0] as Extract<
        AgentEvent,
        { type: "tasks" }
      >;
      const count = event.tasks.length;
      return (
        <div className="py-1">
          <CollapsibleSection
            label={`Creating ${count} task${count !== 1 ? "s" : ""}`}
            badge={
              <ListChecks className="h-3 w-3 text-zinc-500" />
            }
            defaultOpen
          >
            <ol className="ml-6 mt-1 space-y-1 list-decimal list-inside">
              {event.tasks.map((task, i) => (
                <li key={i} className="text-xs text-zinc-400">
                  <span className="text-zinc-300">{task.title}</span>
                  {task.description && (
                    <span className="text-zinc-600 ml-1">
                      — {task.description}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </CollapsibleSection>
        </div>
      );
    }

    // ── Sandbox: compact inline card ──
    case "sandbox": {
      const event = group.events[0] as Extract<
        AgentEvent,
        { type: "sandbox" }
      >;
      return (
        <div className="py-1">
          <div className="inline-flex items-center gap-2 rounded-lg border border-amber-900/40 bg-amber-950/15 px-3 py-2 text-xs">
            <Monitor className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-zinc-400">Sandbox</span>
            <a
              href={event.sandboxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:text-amber-300 font-mono truncate max-w-xs"
            >
              {event.sandboxUrl}
            </a>
          </div>
        </div>
      );
    }

    // ── Preview: compact inline card ──
    case "preview": {
      const event = group.events[0] as Extract<
        AgentEvent,
        { type: "preview" }
      >;
      return (
        <div className="py-1">
          <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs">
            <Globe className="h-3.5 w-3.5 text-cyan-400" />
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
            {event.previewUrl && event.status === "active" && (
              <a
                href={event.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 hover:text-emerald-300 font-mono truncate max-w-xs"
              >
                {event.previewUrl}
              </a>
            )}
          </div>
        </div>
      );
    }

    // ── Artifact: compact inline card ──
    case "artifact": {
      const event = group.events[0] as Extract<
        AgentEvent,
        { type: "artifact" }
      >;
      return (
        <div className="py-1">
          <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs">
            <Package className="h-3.5 w-3.5 text-purple-400" />
            <span className="text-zinc-200">{event.name}</span>
            {event.url && (
              <a
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 hover:text-emerald-300"
              >
                Open
              </a>
            )}
            {event.mime && <Badge variant="neutral">{event.mime}</Badge>}
          </div>
        </div>
      );
    }
  }
}
