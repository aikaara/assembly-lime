import type { AgentRunStatus } from "../../types";

const STATUS_STYLES: Record<AgentRunStatus, string> = {
  queued: "bg-zinc-400",
  running: "bg-blue-500 animate-pulse",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  cancelled: "bg-amber-500",
  awaiting_approval: "bg-amber-400 animate-pulse",
  awaiting_followup: "bg-emerald-400 animate-pulse",
  plan_approved: "bg-emerald-500",
};

const STATUS_LABELS: Record<AgentRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  awaiting_approval: "Awaiting Approval",
  awaiting_followup: "Awaiting Follow-up",
  plan_approved: "Plan Approved",
};

export function StatusDot({
  status,
  showLabel = false,
}: {
  status: AgentRunStatus;
  showLabel?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${STATUS_STYLES[status] ?? "bg-zinc-400"}`} />
      {showLabel && (
        <span className="text-xs text-zinc-400">{STATUS_LABELS[status] ?? status}</span>
      )}
    </span>
  );
}
