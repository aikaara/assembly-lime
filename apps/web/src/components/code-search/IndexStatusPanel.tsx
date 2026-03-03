import { useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { api } from "../../lib/api";

interface IndexStatus {
  id: string;
  repositoryId: string;
  repoFullName: string;
  status: string;
  lastIndexedSha: string | null;
  lastIndexedAt: string | null;
  fileCount: number;
  chunkCount: number;
  error: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-zinc-700 text-zinc-300",
  indexing: "bg-yellow-900/50 text-yellow-300",
  ready: "bg-lime-900/50 text-lime-300",
  failed: "bg-red-900/50 text-red-300",
};

export function IndexStatusPanel({
  statuses,
  onRefresh,
}: {
  statuses: IndexStatus[];
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reindexing, setReindexing] = useState<Set<string>>(new Set());

  const readyCount = statuses.filter((s) => s.status === "ready").length;
  const totalChunks = statuses.reduce((sum, s) => sum + s.chunkCount, 0);

  async function handleReindex(repositoryId: string) {
    setReindexing((prev) => new Set(prev).add(repositoryId));
    try {
      await api.post(`/code-search/reindex/${repositoryId}`);
      setTimeout(onRefresh, 2000);
    } catch {
      // ignore
    } finally {
      setReindexing((prev) => {
        const next = new Set(prev);
        next.delete(repositoryId);
        return next;
      });
    }
  }

  async function handleReindexAll() {
    try {
      await api.post("/code-search/reindex-all");
      setTimeout(onRefresh, 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <span>Index Status</span>
          <span className="text-xs text-zinc-500">
            {readyCount}/{statuses.length} repos indexed &middot; {totalChunks.toLocaleString()} chunks
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleReindexAll();
          }}
          className="text-xs text-lime-400 hover:text-lime-300 transition-colors px-2 py-1 rounded hover:bg-zinc-800"
        >
          Reindex All
        </button>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-2 space-y-1 max-h-64 overflow-y-auto">
          {statuses.length === 0 && (
            <p className="text-xs text-zinc-500 py-2">No repositories indexed yet. Use "Reindex All" to start.</p>
          )}
          {statuses.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between py-1.5 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[s.status] ?? STATUS_BADGE.pending}`}>
                  {s.status}
                </span>
                <span className="font-mono text-zinc-300 truncate">{s.repoFullName}</span>
                <span className="text-zinc-600">
                  {s.fileCount} files &middot; {s.chunkCount} chunks
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {s.lastIndexedAt && (
                  <span className="text-zinc-600">
                    {new Date(s.lastIndexedAt).toLocaleDateString()}
                  </span>
                )}
                {s.error && (
                  <span className="text-red-400 truncate max-w-32" title={s.error}>
                    {s.error}
                  </span>
                )}
                <button
                  onClick={() => handleReindex(s.repositoryId)}
                  disabled={reindexing.has(s.repositoryId)}
                  className="p-1 text-zinc-500 hover:text-zinc-300 disabled:opacity-50 transition-colors"
                  title="Reindex"
                >
                  <RefreshCw className={`h-3 w-3 ${reindexing.has(s.repositoryId) ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
