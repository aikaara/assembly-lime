import type { AgentRunDetailResponse, AgentEvent } from "../../types";

interface TimelinePhase {
  label: string;
  duration: string | null;
  color: string;
  flex: number;
  active?: boolean;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

export function RunTimeline({
  run,
  events,
}: {
  run: AgentRunDetailResponse;
  events: AgentEvent[];
}) {
  const createdAt = new Date(run.createdAt).getTime();
  const startedAt = run.startedAt ? new Date(run.startedAt).getTime() : null;
  const endedAt = run.endedAt ? new Date(run.endedAt).getTime() : null;
  const now = Date.now();

  // Find sandbox and clone events to calculate phase durations
  let sandboxReadyTime: number | null = null;
  let cloneCompleteTime: number | null = null;
  let firstExecutionTime: number | null = null;

  for (const e of events) {
    if (e.type === "status") {
      if (e.status === "running" && !firstExecutionTime) {
        firstExecutionTime = startedAt;
      }
    }
    if (e.type === "sandbox" && !sandboxReadyTime) {
      sandboxReadyTime = startedAt
        ? startedAt + 5000
        : createdAt + 5000;
    }
    if (e.type === "log" && e.text?.includes("clone") && !cloneCompleteTime) {
      cloneCompleteTime = sandboxReadyTime
        ? sandboxReadyTime + 3000
        : createdAt + 8000;
    }
  }

  const isRunning = !endedAt;
  const totalDuration = (endedAt ?? now) - createdAt;

  const phases: TimelinePhase[] = [];

  // Queued
  const queueDuration = startedAt ? startedAt - createdAt : isRunning ? now - createdAt : 2000;
  phases.push({
    label: "Queued",
    duration: formatDuration(queueDuration),
    color: "bg-zinc-700",
    flex: Math.max(1, Math.round((queueDuration / totalDuration) * 20)),
  });

  if (startedAt) {
    // Sandbox setup (estimate ~5s if no specific data)
    const sandboxDuration = sandboxReadyTime
      ? sandboxReadyTime - startedAt
      : Math.min(5000, totalDuration * 0.05);
    phases.push({
      label: "Sandbox",
      duration: formatDuration(sandboxDuration),
      color: "bg-blue-500/40",
      flex: Math.max(1, Math.round((sandboxDuration / totalDuration) * 20)),
    });

    // Clone
    const cloneDuration = cloneCompleteTime && sandboxReadyTime
      ? cloneCompleteTime - sandboxReadyTime
      : Math.min(3000, totalDuration * 0.03);
    phases.push({
      label: "Clone",
      duration: formatDuration(cloneDuration),
      color: "bg-blue-500/40",
      flex: Math.max(1, Math.round((cloneDuration / totalDuration) * 20)),
    });

    // Executing (the main phase)
    const execStart = cloneCompleteTime ?? (sandboxReadyTime ? sandboxReadyTime + 3000 : startedAt + 8000);
    const execEnd = endedAt ? endedAt - 5000 : now; // leave room for commit/push
    const execDuration = Math.max(0, execEnd - execStart);
    phases.push({
      label: "Executing",
      duration: formatDuration(execDuration),
      color: "bg-lime-500/50",
      flex: Math.max(4, Math.round((execDuration / totalDuration) * 20)),
      active: isRunning,
    });

    if (endedAt) {
      // Commit + push (estimate ~5s total)
      phases.push({
        label: "Commit",
        duration: "3s",
        color: "bg-blue-500/40",
        flex: 1,
      });
      phases.push({
        label: "Push",
        duration: "2s",
        color: "bg-blue-500/40",
        flex: 1,
      });

      // Done
      const isSuccess = run.status === "completed" || run.status === "plan_approved";
      phases.push({
        label: isSuccess ? "Done" : run.status === "failed" ? "Failed" : "Ended",
        duration: null,
        color: isSuccess ? "bg-green-500/40" : run.status === "failed" ? "bg-red-500/40" : "bg-zinc-600",
        flex: 1,
      });
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center gap-1">
        {phases.map((phase, i) => (
          <div
            key={i}
            className="flex flex-col items-center"
            style={{ flex: phase.flex }}
          >
            <div className="flex items-center w-full">
              <div
                className={`h-2 flex-1 ${phase.color} ${
                  i === 0 ? "rounded-l-full" : ""
                } ${i === phases.length - 1 ? "rounded-r-full" : ""} ${
                  phase.active ? "animate-pulse" : ""
                }`}
              />
            </div>
            <span
              className={`mt-2 text-[10px] ${
                phase.active
                  ? "text-lime-400 font-medium"
                  : phase.label === "Done"
                    ? "text-green-400"
                    : phase.label === "Failed"
                      ? "text-red-400"
                      : "text-zinc-500"
              }`}
            >
              {phase.label}
            </span>
            {phase.duration && (
              <span className="text-[10px] text-zinc-600 font-mono">
                {phase.duration}
              </span>
            )}
            {!phase.duration && phase.label === "Done" && (
              <span className="text-[10px] text-zinc-600 font-mono">
                &#10003;
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
