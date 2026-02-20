import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Clock } from "lucide-react";
import { api } from "../lib/api";
import type {
  AgentRunDetailResponse,
  AgentEventResponse,
  AgentEvent,
  AgentRunStatus,
} from "../types";
import { useAgentRunStream } from "../hooks/useAgentRunStream";
import { TranscriptPanel } from "../components/command-center/TranscriptPanel";
import { StatusDot } from "../components/ui/StatusDot";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";

function parseEventPayload(raw: AgentEventResponse): AgentEvent | null {
  try {
    const payload = raw.payload as Record<string, unknown>;
    return { type: raw.type, ...payload } as unknown as AgentEvent;
  } catch {
    return null;
  }
}

/** Statuses where the WebSocket should stay connected */
const LIVE_STATUSES: AgentRunStatus[] = [
  "queued",
  "running",
  "awaiting_followup",
  "awaiting_approval",
];

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<AgentRunDetailResponse | null>(null);
  const [historicalEvents, setHistoricalEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Connect WebSocket if run is still alive
  const isLive = run ? LIVE_STATUSES.includes(run.status) : false;
  const { events: liveEvents, connectionState, runStatus: liveRunStatus } =
    useAgentRunStream(isLive && id ? id : null);

  // Derive effective run status: live WS status takes priority over fetched status
  const effectiveStatus = liveRunStatus ?? run?.status ?? null;

  // Update the run object when live status changes (so header stays in sync)
  useEffect(() => {
    if (liveRunStatus && run && liveRunStatus !== run.status) {
      setRun((prev) => (prev ? { ...prev, status: liveRunStatus } : prev));
    }
  }, [liveRunStatus]);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    Promise.all([
      api.get<AgentRunDetailResponse>(`/agent-runs/${id}`),
      api.get<AgentEventResponse[]>(`/agent-runs/${id}/events`),
    ])
      .then(([runData, eventsData]) => {
        setRun(runData);
        const parsed = eventsData
          .map(parseEventPayload)
          .filter((e): e is AgentEvent => e !== null);
        setHistoricalEvents(parsed);
      })
      .catch((err) => {
        console.error("Failed to load run:", err);
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSendMessage(text: string) {
    if (!id) return;
    try {
      await api.post(`/agent-runs/${id}/message`, { text });
    } catch (err) {
      console.error("Failed to send message:", err);
    }
  }

  async function handleApprove() {
    if (!id) return;
    try {
      await api.post(`/agent-runs/${id}/approve`);
    } catch (err) {
      console.error("Failed to approve run:", err);
    }
  }

  async function handleReject() {
    if (!id) return;
    try {
      await api.post(`/agent-runs/${id}/reject`);
    } catch (err) {
      console.error("Failed to reject run:", err);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        Loading...
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Clock}
          title="Run not found"
          description={`No agent run found with ID ${id}`}
          action={
            <Link
              to="/runs"
              className="text-emerald-400 hover:text-emerald-300 text-sm"
            >
              Back to runs
            </Link>
          }
        />
      </div>
    );
  }

  const allEvents = [...historicalEvents, ...liveEvents];

  // Derive run status from historical events if not live
  const historicalStatus = (() => {
    for (let i = historicalEvents.length - 1; i >= 0; i--) {
      const e = historicalEvents[i];
      if (e.type === "status") return e.status;
    }
    return null;
  })();

  const displayStatus = effectiveStatus ?? historicalStatus;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-zinc-800 px-6 py-4 shrink-0">
        <Link
          to="/runs"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200 mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          All Runs
        </Link>

        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-zinc-100 font-mono">
            Run #{run.id}
          </h2>
          <StatusDot status={run.status} showLabel />
          <Badge variant={run.provider === "claude" ? "purple" : "info"}>
            {run.provider}
          </Badge>
          <Badge variant="neutral">{run.mode}</Badge>
          {isLive && (
            <span
              className={`h-2 w-2 rounded-full ${
                connectionState === "connected"
                  ? "bg-emerald-500"
                  : "bg-amber-500 animate-pulse"
              }`}
            />
          )}
        </div>

        <p className="mt-2 text-sm text-zinc-400">{run.inputPrompt}</p>

        <div className="mt-2 flex gap-4 text-xs text-zinc-500">
          <span>Created: {new Date(run.createdAt).toLocaleString()}</span>
          {run.startedAt && (
            <span>Started: {new Date(run.startedAt).toLocaleString()}</span>
          )}
          {run.endedAt && (
            <span>Ended: {new Date(run.endedAt).toLocaleString()}</span>
          )}
        </div>
      </div>

      {/* Transcript with interactive features */}
      <TranscriptPanel
        events={allEvents}
        connectionState={isLive ? connectionState : "disconnected"}
        runId={id ?? null}
        runStatus={displayStatus}
        onSendMessage={handleSendMessage}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
}
