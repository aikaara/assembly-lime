import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type {
  AgentProviderId,
  AgentMode,
  AgentRunCreateResponse,
  AgentRunDetailResponse,
  AgentEventResponse,
  AgentEvent,
  AgentRunStatus,
} from "../types";
import { api } from "../lib/api";
import { useAgentRunStream } from "../hooks/useAgentRunStream";
import { useRecentRuns } from "../hooks/useRecentRuns";
import { useAuth } from "../hooks/useAuth";
import { PromptPanel } from "../components/command-center/PromptPanel";
import { TranscriptPanel } from "../components/command-center/TranscriptPanel";
import { StatusDot } from "../components/ui/StatusDot";

function parseEventPayload(raw: AgentEventResponse): AgentEvent | null {
  try {
    const payload = raw.payload as Record<string, unknown>;
    return { type: raw.type, ...payload } as unknown as AgentEvent;
  } catch {
    return null;
  }
}

/** Statuses where the WS should stay connected */
const LIVE_STATUSES: AgentRunStatus[] = [
  "queued",
  "running",
  "awaiting_followup",
  "awaiting_approval",
  "awaiting_env_vars",
];

export function CommandCenterPage() {
  const auth = useAuth();
  const { runId: urlRunId } = useParams<{ runId?: string }>();
  const [activeRunId, setActiveRunId] = useState<string | null>(
    urlRunId ?? null,
  );
  const [submitting, setSubmitting] = useState(false);
  const { addRunId } = useRecentRuns();

  // Run detail (loaded for existing runs)
  const [run, setRun] = useState<AgentRunDetailResponse | null>(null);
  const [historicalEvents, setHistoricalEvents] = useState<AgentEvent[]>([]);
  const [loadingRun, setLoadingRun] = useState(false);

  const projectId =
    auth.status === "authenticated" ? auth.currentProjectId : null;

  // When URL runId changes, sync it
  useEffect(() => {
    if (urlRunId && urlRunId !== activeRunId) {
      setActiveRunId(urlRunId);
    }
  }, [urlRunId]);

  // Load existing run details + historical events
  useEffect(() => {
    if (!activeRunId) {
      setRun(null);
      setHistoricalEvents([]);
      return;
    }

    setLoadingRun(true);
    Promise.all([
      api.get<AgentRunDetailResponse>(`/agent-runs/${activeRunId}`),
      api.get<AgentEventResponse[]>(`/agent-runs/${activeRunId}/events`),
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
        setRun(null);
        setHistoricalEvents([]);
      })
      .finally(() => setLoadingRun(false));
  }, [activeRunId]);

  // Connect WS only for live runs
  const isLive = run ? LIVE_STATUSES.includes(run.status) : !run && !!activeRunId;
  const {
    events: liveEvents,
    connectionState,
    runStatus: liveRunStatus,
  } = useAgentRunStream(isLive && activeRunId ? activeRunId : null);

  // Effective status: live WS takes priority
  const effectiveStatus = liveRunStatus ?? run?.status ?? null;

  // Keep run object in sync with live status
  useEffect(() => {
    if (liveRunStatus && run && liveRunStatus !== run.status) {
      setRun((prev) => (prev ? { ...prev, status: liveRunStatus } : prev));
    }
  }, [liveRunStatus]);

  // Derive historical status for completed runs (no WS)
  const historicalStatus = (() => {
    for (let i = historicalEvents.length - 1; i >= 0; i--) {
      const e = historicalEvents[i];
      if (e.type === "status") return e.status;
    }
    return null;
  })();

  const displayStatus = effectiveStatus ?? historicalStatus;

  // All events = historical + live (deduplication not needed — WS only streams new events)
  const allEvents = [...historicalEvents, ...liveEvents];

  // ── Handlers ──

  async function handleSubmit(
    prompt: string,
    provider: AgentProviderId,
    mode: AgentMode,
    repositoryId?: number,
  ) {
    if (!projectId) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        projectId: Number(projectId),
        provider,
        mode,
        prompt,
      };
      if (repositoryId) {
        body.repositoryId = repositoryId;
      }
      const newRun = await api.post<AgentRunCreateResponse>(
        "/agent-runs/",
        body,
      );
      // Clear historical state and switch to new run
      setHistoricalEvents([]);
      setRun(null);
      setActiveRunId(newRun.id);
      addRunId(newRun.id);
    } catch (err) {
      console.error("Failed to create agent run:", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendMessage(text: string) {
    if (!activeRunId) return;
    try {
      await api.post(`/agent-runs/${activeRunId}/message`, { text });
    } catch (err) {
      console.error("Failed to send message:", err);
    }
  }

  async function handleApprove() {
    if (!activeRunId) return;
    try {
      await api.post(`/agent-runs/${activeRunId}/approve`);
    } catch (err) {
      console.error("Failed to approve run:", err);
    }
  }

  async function handleReject() {
    if (!activeRunId) return;
    try {
      await api.post(`/agent-runs/${activeRunId}/reject`);
    } catch (err) {
      console.error("Failed to reject run:", err);
    }
  }

  async function handleSubmitEnvVars(vars: Record<string, string>) {
    if (!activeRunId) return;
    try {
      await api.post(`/agent-runs/${activeRunId}/env-vars`, { envVars: vars });
    } catch (err) {
      console.error("Failed to submit env vars:", err);
    }
  }

  // ── Render ──

  const hasActiveRun = !!activeRunId && (!!run || loadingRun);

  return (
    <div className="flex h-full flex-col">
      {/* Run header (when viewing an existing run) */}
      {hasActiveRun && run && (
        <div className="border-b border-zinc-800 px-6 py-2 shrink-0">
          <div className="flex items-center gap-3">
            <Link
              to="/command-center"
              onClick={() => {
                setActiveRunId(null);
                setRun(null);
                setHistoricalEvents([]);
              }}
              className="inline-flex items-center justify-center rounded-lg p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="text-sm font-mono text-zinc-300">
              Run #{run.id}
            </span>
            <StatusDot status={run.status} showLabel />
            <div className="flex-1" />
            <span className="text-xs text-zinc-600">
              {run.provider} / {run.mode}
            </span>
          </div>
        </div>
      )}

      {/* Prompt panel (show when no active run, or collapsed) */}
      {!hasActiveRun && (
        <PromptPanel
          onSubmit={handleSubmit}
          disabled={submitting || !projectId}
          projectId={projectId}
        />
      )}

      {/* Loading state */}
      {loadingRun && (
        <div className="flex items-center justify-center py-8 text-zinc-500 text-sm">
          Loading run...
        </div>
      )}

      {/* Transcript panel */}
      <TranscriptPanel
        events={allEvents}
        connectionState={isLive ? connectionState : "disconnected"}
        runId={activeRunId}
        runStatus={displayStatus}
        inputPrompt={run?.inputPrompt}
        onSendMessage={handleSendMessage}
        onApprove={handleApprove}
        onReject={handleReject}
        onSubmitEnvVars={handleSubmitEnvVars}
      />
    </div>
  );
}
