import { useState } from "react";
import type { AgentProviderId, AgentMode } from "../types";
import { api } from "../lib/api";
import type { AgentRunCreateResponse } from "../types";
import { useAgentRunStream } from "../hooks/useAgentRunStream";
import { useRecentRuns } from "../hooks/useRecentRuns";
import { useAuth } from "../hooks/useAuth";
import { PromptPanel } from "../components/command-center/PromptPanel";
import { TranscriptPanel } from "../components/command-center/TranscriptPanel";

export function CommandCenterPage() {
  const auth = useAuth();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { addRunId } = useRecentRuns();
  const { events, connectionState } = useAgentRunStream(activeRunId);

  const projectId =
    auth.status === "authenticated" ? auth.currentProjectId : null;

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
      const run = await api.post<AgentRunCreateResponse>("/agent-runs/", body);
      setActiveRunId(run.id);
      addRunId(run.id);
    } catch (err) {
      console.error("Failed to create agent run:", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PromptPanel onSubmit={handleSubmit} disabled={submitting || !projectId} projectId={projectId} />
      <TranscriptPanel events={events} connectionState={connectionState} />
    </div>
  );
}
