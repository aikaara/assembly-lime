import { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, Circle, Loader2 } from "lucide-react";

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
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="border-t border-zinc-800 px-4 py-2">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full text-left"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
        )}
        <span className="text-xs font-medium text-zinc-400">
          Tasks: {completed}/{total} complete
        </span>
        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden ml-2">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </button>

      {!collapsed && (
        <ul className="mt-2 space-y-1">
          {tasks.map((task) => (
            <li key={task.ticketId} className="flex items-start gap-2 py-0.5">
              {task.status === "completed" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              ) : task.status === "in_progress" ? (
                <Loader2 className="h-4 w-4 text-blue-400 shrink-0 mt-0.5 animate-spin" />
              ) : (
                <Circle className="h-4 w-4 text-zinc-600 shrink-0 mt-0.5" />
              )}
              <span
                className={`text-xs ${
                  task.status === "completed"
                    ? "text-zinc-500 line-through"
                    : task.status === "in_progress"
                      ? "text-zinc-200"
                      : "text-zinc-400"
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
