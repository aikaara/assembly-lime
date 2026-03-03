import { useState } from "react";
import type { AgentEvent } from "../../types";
import { DiffViewer } from "../ui/DiffViewer";
import { Eye, FileCode, ListChecks, Terminal, CheckCircle2 } from "lucide-react";

type TabId = "diff" | "tasks" | "terminal" | "preview";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

export function ArtifactPanel({ events }: { events: AgentEvent[] }) {
  const [activeTab, setActiveTab] = useState<TabId>("diff");

  // Extract artifacts from events
  const diffs = events.filter(
    (e): e is Extract<AgentEvent, { type: "diff" }> => e.type === "diff",
  );

  const tasks = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "tasks") {
        return (events[i] as Extract<AgentEvent, { type: "tasks" }>).tasks;
      }
    }
    return [];
  })();

  const logs = events.filter(
    (e): e is Extract<AgentEvent, { type: "log" }> => e.type === "log",
  );

  const previewEvent = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "preview") {
        return events[i] as Extract<AgentEvent, { type: "preview" }>;
      }
    }
    return null;
  })();

  const diffStats = diffs.reduce(
    (acc, d) => {
      const lines = d.unifiedDiff.split("\n");
      const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
      const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
      return { added: acc.added + added, removed: acc.removed + removed };
    },
    { added: 0, removed: 0 },
  );

  const tabs: Tab[] = [
    {
      id: "diff",
      label: "Diff",
      icon: FileCode,
      badge: diffs.length > 0 ? `+${diffStats.added} -${diffStats.removed}` : undefined,
    },
    {
      id: "tasks",
      label: "Tasks",
      icon: ListChecks,
      badge: tasks.length > 0 ? String(tasks.length) : undefined,
    },
    { id: "terminal", label: "Terminal", icon: Terminal },
    { id: "preview", label: "Preview", icon: Eye },
  ];

  return (
    <div className="flex flex-col flex-1 min-w-[300px] bg-zinc-950">
      {/* Tab bar */}
      <div className="flex items-center border-b border-zinc-800 px-1 shrink-0">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                isActive
                  ? "text-lime-400 border-lime-400"
                  : "text-zinc-500 hover:text-zinc-300 border-transparent"
              }`}
            >
              {tab.label}
              {tab.badge && (
                <span
                  className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] ${
                    isActive ? "bg-lime-500/15" : "bg-zinc-800"
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "diff" && (
          <div>
            {diffs.length === 0 ? (
              <div className="flex items-center justify-center h-full py-16">
                <div className="text-center">
                  <FileCode className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
                  <p className="text-sm text-zinc-500">No diffs yet</p>
                  <p className="text-xs text-zinc-600 mt-1">
                    Code changes will appear here
                  </p>
                </div>
              </div>
            ) : (
              diffs.map((diff, i) => (
                <div key={i}>
                  <DiffViewer diff={diff.unifiedDiff} summary={diff.summary} />
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "tasks" && (
          <div className="p-4 space-y-3">
            {tasks.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <div className="text-center">
                  <ListChecks className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
                  <p className="text-sm text-zinc-500">No tasks planned</p>
                  <p className="text-xs text-zinc-600 mt-1">
                    Tasks will appear when the agent plans work
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
                <h3 className="text-sm font-medium text-zinc-200">
                  Planned Tasks
                </h3>
                <div className="space-y-2">
                  {tasks.map((task, i) => (
                    <div key={i} className="flex items-start gap-3 group">
                      <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-zinc-600" />
                      <div>
                        <p className="text-sm text-zinc-300 group-hover:text-zinc-100">
                          {task.title}
                        </p>
                        {task.description && (
                          <p className="text-xs text-zinc-600 mt-0.5">
                            {task.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "terminal" && (
          <div className="bg-zinc-950 p-4">
            {logs.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <div className="text-center">
                  <Terminal className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
                  <p className="text-sm text-zinc-500">No terminal output</p>
                  <p className="text-xs text-zinc-600 mt-1">
                    Command output will appear here
                  </p>
                </div>
              </div>
            ) : (
              <pre className="font-mono text-xs text-zinc-400 leading-5 whitespace-pre-wrap">
                {logs.map((l) => l.text).join("\n")}
              </pre>
            )}
          </div>
        )}

        {activeTab === "preview" && (
          <div className="flex items-center justify-center h-full py-16">
            {previewEvent?.previewUrl ? (
              <iframe
                src={previewEvent.previewUrl}
                className="w-full h-full border-0"
                title="Preview"
              />
            ) : (
              <div className="text-center">
                <Eye className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
                <p className="text-sm text-zinc-500">No preview available</p>
                <p className="text-xs text-zinc-600 mt-1">
                  Preview will appear when a dev server is running
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
