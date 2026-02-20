import { useState } from "react";
import {
  ChevronRight,
  CheckCircle2,
  Circle,
  Loader2,
} from "lucide-react";

type Task = {
  ticketId: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed";
};

export function TaskProgressWidget({ tasks }: { tasks: Task[] }) {
  const [collapsed, setCollapsed] = useState(false);

  const completed = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;

  // Find the current in-progress task name
  const currentTask = tasks.find((t) => t.status === "in_progress");

  return (
    <div className="mb-2 rounded-xl border border-zinc-700/60 bg-zinc-900/80 backdrop-blur-sm shadow-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/40 transition-colors"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-zinc-500 shrink-0 transition-transform duration-200 ${!collapsed ? "rotate-90" : ""}`}
        />
        <span className="flex-1 text-xs text-zinc-300 truncate">
          {currentTask
            ? currentTask.title
            : completed === total
              ? "All tasks complete"
              : "Tasks"}
        </span>
        <span className="text-xs font-mono text-zinc-500 shrink-0">
          {completed}/{total}
        </span>
      </button>

      {/* Task list */}
      {!collapsed && (
        <ul className="border-t border-zinc-800/60 px-3 py-1.5 space-y-0.5">
          {tasks.map((task, i) => (
            <li key={task.ticketId} className="flex items-center gap-2 py-0.5">
              <span className="text-[10px] text-zinc-600 w-4 text-right shrink-0">
                {i + 1}
              </span>
              {task.status === "completed" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              ) : task.status === "in_progress" ? (
                <Loader2 className="h-3.5 w-3.5 text-blue-400 shrink-0 animate-spin" />
              ) : (
                <Circle className="h-3.5 w-3.5 text-zinc-700 shrink-0" />
              )}
              <span
                className={`text-xs truncate ${
                  task.status === "completed"
                    ? "text-zinc-600"
                    : task.status === "in_progress"
                      ? "text-zinc-200 font-medium"
                      : "text-zinc-500"
                }`}
              >
                {task.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
