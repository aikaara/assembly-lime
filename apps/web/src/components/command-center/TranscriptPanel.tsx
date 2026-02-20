import { useEffect, useRef, useState } from "react";
import type { AgentEvent, AgentRunStatus } from "../../types";
import type { ConnectionState } from "./types";
import { useEventGroups } from "../../hooks/useEventGroups";
import { EventGroupCard } from "./EventGroupCard";
import { TaskProgressWidget } from "./TaskProgressWidget";
import { ApprovalBar } from "./ApprovalBar";
import { ArrowUp, ScrollText } from "lucide-react";
import { EmptyState } from "../ui/EmptyState";

const TERMINAL_STATUSES: AgentRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export function TranscriptPanel({
  events,
  connectionState,
  runId,
  runStatus,
  inputPrompt,
  onSendMessage,
  onApprove,
  onReject,
}: {
  events: AgentEvent[];
  connectionState: ConnectionState;
  runId: string | null;
  runStatus: AgentRunStatus | null;
  inputPrompt?: string | null;
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

  const groups = useEventGroups(events, inputPrompt);

  // Derive latest tasks from events
  const latestTasks = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "tasks") {
        return (events[i] as Extract<AgentEvent, { type: "tasks" }>).tasks;
      }
    }
    return null;
  })();

  const isTerminal = runStatus
    ? TERMINAL_STATUSES.includes(runStatus)
    : false;

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
      {/* Events list — centered column */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-4">
          {groups.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No events yet"
              description="Submit a prompt to start an agent run. Events will stream here in real time."
            />
          ) : (
            groups.map((group, i) => (
              <EventGroupCard key={i} group={group} />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Bottom area: task widget + approval + input */}
      {showChatInput && (
        <div className="shrink-0">
          <div className="max-w-3xl mx-auto px-4">
            {/* Floating task progress widget */}
            {latestTasks && latestTasks.length > 0 && (
              <TaskProgressWidget tasks={latestTasks} />
            )}

            {/* Approval bar */}
            {runStatus === "awaiting_approval" && onApprove && onReject && (
              <ApprovalBar onApprove={onApprove} onReject={onReject} />
            )}

            {/* Chat input */}
            <div className="py-3">
              <div className="relative flex items-end rounded-xl border border-zinc-700 bg-zinc-900 focus-within:border-emerald-600 focus-within:ring-1 focus-within:ring-emerald-600 transition-all">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    runStatus === "awaiting_followup"
                      ? "Send a follow-up message..."
                      : isTerminal
                        ? "Send a message to continue..."
                        : "Send a message..."
                  }
                  rows={1}
                  className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none"
                />
                <button
                  onClick={handleSend}
                  disabled={!inputText.trim() || sending}
                  className="m-1.5 rounded-lg bg-emerald-600 p-2 text-white hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
              {/* Connection indicator + helper text */}
              <div className="flex items-center justify-center gap-2 mt-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    connectionState === "connected"
                      ? "bg-emerald-500"
                      : connectionState === "connecting"
                        ? "bg-amber-500 animate-pulse"
                        : "bg-zinc-600"
                  }`}
                />
                <span className="text-[10px] text-zinc-600">
                  {runStatus === "awaiting_followup"
                    ? "Agent is waiting for your input"
                    : connectionState === "connected"
                      ? "Connected"
                      : connectionState === "connecting"
                        ? "Reconnecting..."
                        : "Disconnected"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
