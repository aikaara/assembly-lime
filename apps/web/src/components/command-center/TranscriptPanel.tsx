import { useEffect, useRef, useState } from "react";
import type { AgentEvent, AgentRunStatus } from "../../types";
import type { ConnectionState } from "./types";
import { EventCard } from "./EventCard";
import { TaskProgressWidget } from "./TaskProgressWidget";
import { ApprovalBar } from "./ApprovalBar";
import { Badge } from "../ui/Badge";
import { ScrollText, Send } from "lucide-react";
import { EmptyState } from "../ui/EmptyState";

const TERMINAL_STATUSES: AgentRunStatus[] = ["completed", "failed", "cancelled"];

export function TranscriptPanel({
  events,
  connectionState,
  runId,
  runStatus,
  onSendMessage,
  onApprove,
  onReject,
}: {
  events: AgentEvent[];
  connectionState: ConnectionState;
  runId: string | null;
  runStatus: AgentRunStatus | null;
  onSendMessage?: (text: string) => void;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  // Derive latest tasks from events
  const latestTasks = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "tasks") {
        return (events[i] as Extract<AgentEvent, { type: "tasks" }>).tasks;
      }
    }
    return null;
  })();

  const isTerminal = runStatus ? TERMINAL_STATUSES.includes(runStatus) : false;

  // Always show chat input when there's a run loaded
  const showChatInput = !!runId && !!onSendMessage;

  async function handleSend() {
    const text = inputText.trim();
    if (!text || !onSendMessage) return;
    setSending(true);
    try {
      onSendMessage(text);
      setInputText("");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Connection status */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
        <span
          className={`h-2 w-2 rounded-full ${
            connectionState === "connected"
              ? "bg-emerald-500"
              : connectionState === "connecting"
                ? "bg-amber-500 animate-pulse"
                : "bg-zinc-600"
          }`}
        />
        <span className="text-xs text-zinc-500">
          {connectionState === "connected"
            ? "Connected"
            : connectionState === "connecting"
              ? "Connecting..."
              : "Disconnected"}
        </span>
        {events.length > 0 && (
          <Badge variant="neutral">{events.length} events</Badge>
        )}
        {runStatus && (
          <Badge
            variant={
              runStatus === "awaiting_followup"
                ? "success"
                : runStatus === "awaiting_approval"
                  ? "warning"
                  : runStatus === "running"
                    ? "info"
                    : "neutral"
            }
          >
            {runStatus.replace(/_/g, " ")}
          </Badge>
        )}
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
        {events.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No events yet"
            description="Submit a prompt to start an agent run. Events will stream here in real time."
          />
        ) : (
          events.map((event, i) => <EventCard key={i} event={event} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Task progress widget */}
      {latestTasks && latestTasks.length > 0 && (
        <TaskProgressWidget tasks={latestTasks} />
      )}

      {/* Approval bar */}
      {runStatus === "awaiting_approval" && onApprove && onReject && (
        <ApprovalBar onApprove={onApprove} onReject={onReject} />
      )}

      {/* Chat input — always visible when a run is loaded */}
      {showChatInput && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                runStatus === "awaiting_followup"
                  ? "Send a follow-up message..."
                  : isTerminal
                    ? "Send a message to continue this run..."
                    : "Send a message to the agent..."
              }
              rows={1}
              className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || sending}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          {runStatus === "awaiting_followup" && (
            <p className="text-xs text-emerald-500/70 mt-1">
              Agent is waiting for your input. Press Enter to send.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
