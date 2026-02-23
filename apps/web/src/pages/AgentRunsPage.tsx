import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Play, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import type { AgentRunDetailResponse } from "../types";
import { StatusDot } from "../components/ui/StatusDot";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";

const PAGE_SIZE = 25;

export function AgentRunsPage() {
  const auth = useAuth();
  const [runs, setRuns] = useState<AgentRunDetailResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const projectId =
    auth.status === "authenticated" ? auth.currentProjectId : null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    const offset = (page - 1) * PAGE_SIZE;
    api
      .get<{ data: AgentRunDetailResponse[]; total: number }>(
        `/projects/${projectId}/runs?offset=${offset}&limit=${PAGE_SIZE}`
      )
      .then((res) => {
        setRuns(res.data);
        setTotal(res.total);
      })
      .catch((err) => {
        console.error("Failed to fetch runs:", err);
        setError(String(err));
        setRuns([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [projectId, page]);

  if (!loading && error) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Play}
          title="Failed to load runs"
          description={error}
        />
      </div>
    );
  }

  if (!loading && runs.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Play}
          title="No agent runs yet"
          description={`Project: ${projectId ?? "none"}. Start a run from the Command Center and it will appear here.`}
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <span className="text-sm text-zinc-500">
            Page {page} of {totalPages} ({total} runs)
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
