import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import type { AgentRunDetailResponse } from "../types";
import { StatusDot } from "../components/ui/StatusDot";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";

export function AgentRunsPage() {
  const auth = useAuth();
  const [runs, setRuns] = useState<AgentRunDetailResponse[]>([]);
  const [loading, setLoading] = useState(true);

  const projectId =
    auth.status === "authenticated" ? auth.currentProjectId : null;

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api
      .get<AgentRunDetailResponse[]>(`/projects/${projectId}/runs/`)
      .then(setRuns)
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (!loading && runs.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Play}
          title="No agent runs yet"
          description="Start a run from the Command Center and it will appear here."
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Provider
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Mode
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Prompt
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  Loading...
                </td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-zinc-800/50 hover:bg-zinc-900/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/command-center/${run.id}`}
                      className="text-emerald-400 hover:text-emerald-300 font-mono"
                    >
                      #{run.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        run.provider === "claude" ? "purple" : "info"
                      }
                    >
                      {run.provider}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="neutral">{run.mode}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <StatusDot status={run.status} showLabel />
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    <p className="text-zinc-300 truncate">
                      {run.inputPrompt}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">
                    {new Date(run.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
