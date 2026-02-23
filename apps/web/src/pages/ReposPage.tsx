import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { GitBranch, ExternalLink, RefreshCw, Bell, BellOff, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import { EmptyState } from "../components/ui/EmptyState";
import type { Repository } from "../types";

const API_BASE = "/api";
const PAGE_SIZE = 30;

type RepoWithWebhook = Repository & {
  webhook: { id: string; events: string[] } | null;
};

type PaginatedResponse = {
  data: RepoWithWebhook[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export function ReposPage() {
  const [repos, setRepos] = useState<RepoWithWebhook[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const loadRepos = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
      if (q.trim()) params.set("search", q.trim());
      const res = await api.get<PaginatedResponse>(`/repositories?${params}`);
      setRepos(res.data);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch (err) {
      console.error("Failed to load repos:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadRepos(1, "");
  }, [loadRepos]);

  // Debounced search — reset to page 1
  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      loadRepos(1, value);
    }, 300);
  }

  function handlePageChange(p: number) {
    setPage(p);
    loadRepos(p, search);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api.post<{ fetched: number; imported: number; error?: string; message?: string }>(
        "/repositories/sync"
      );
      if (result.error === "no_connector") {
        window.location.href = `${API_BASE}/auth/github`;
        return;
      }
      setSyncResult(`${result.fetched} repos found, ${result.imported} new imported`);
      loadRepos(page, search);
    } catch (err) {
      console.error("Sync failed:", err);
      setSyncResult("Sync failed. Try connecting GitHub first.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleSubscribeWebhook(repoId: string) {
    setSubscribing(repoId);
    try {
      const result = await api.post<{ id?: string; error?: string; message?: string }>(
        `/repositories/${repoId}/webhook`
      );
      if (result.error) {
        console.error("Webhook failed:", result.message);
      } else {
        loadRepos(page, search);
      }
    } catch (err) {
      console.error("Failed to subscribe webhook:", err);
    } finally {
      setSubscribing(null);
    }
  }

  if (loading && repos.length === 0) {
    return <div className="flex items-center justify-center h-full text-zinc-500">Loading...</div>;
  }

  if (total === 0 && !search.trim()) {
    return (
      <div className="p-6 space-y-6">
        <EmptyState
          icon={GitBranch}
          title="No repositories"
          description="Sync your GitHub repositories or connect your GitHub account."
          action={
            <div className="flex items-center gap-3">
              <button
                onClick={handleSync}
                disabled={syncing}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing..." : "Sync Repos"}
              </button>
              <a
                href={`${API_BASE}/auth/github`}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600 transition-colors"
              >
                <GitBranch className="h-4 w-4" />
                Connect GitHub
              </a>
            </div>
          }
        />
        {syncResult && (
          <div className="max-w-md mx-auto rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-300 text-center">
            {syncResult}
          </div>
        )}
      </div>
    );
  }

  // Build page numbers with ellipsis for large page counts
  function getPageNumbers(): (number | "...")[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | "...")[] = [1];
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    if (start > 2) pages.push("...");
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) pages.push("...");
    pages.push(totalPages);
    return pages;
  }

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Repositories</h1>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing..." : "Sync Repos"}
        </button>
      </div>

      {syncResult && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-300 flex items-center justify-between">
          <span>{syncResult}</span>
          <button onClick={() => setSyncResult(null)} className="text-xs text-zinc-500 hover:text-zinc-300">
            Dismiss
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search repositories..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 py-2 pl-9 pr-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-colors"
        />
        {search && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
            {total} result{total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Repo list */}
      <div className="space-y-2">
        {loading ? (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-8 text-center text-sm text-zinc-500">
            Loading...
          </div>
        ) : repos.length === 0 ? (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-8 text-center text-sm text-zinc-500">
            No repositories match "{search}"
          </div>
        ) : (
          repos.map((r) => {
            const hasWebhook = !!r.webhook;
            return (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 hover:border-zinc-600 transition-colors"
              >
                <Link to={`/repos/${r.id}`} className="flex items-center gap-3 min-w-0 flex-1">
                  <GitBranch className="h-4 w-4 text-zinc-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-zinc-200">{r.fullName}</span>
                    <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
                      <span>Branch: {r.defaultBranch}</span>
                      <span className={r.isEnabled ? "text-emerald-500" : "text-zinc-600"}>
                        {r.isEnabled ? "Enabled" : "Disabled"}
                      </span>
                      {hasWebhook && (
                        <span className="text-blue-400 flex items-center gap-1">
                          <Bell className="h-3 w-3" /> Webhook active
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  {!hasWebhook ? (
                    <button
                      onClick={() => handleSubscribeWebhook(r.id)}
                      disabled={subscribing === r.id}
                      className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 transition-colors"
                      title="Subscribe to push, PR, and workflow events"
                    >
                      <BellOff className={`h-3.5 w-3.5 ${subscribing === r.id ? "animate-pulse" : ""}`} />
                      {subscribing === r.id ? "..." : "Subscribe"}
                    </button>
                  ) : (
                    <span className="flex items-center gap-1 rounded-md bg-blue-900/30 border border-blue-800/50 px-2.5 py-1.5 text-xs text-blue-400">
                      <Bell className="h-3.5 w-3.5" /> Subscribed
                    </span>
                  )}
                  <Link to={`/repos/${r.id}`}>
                    <ExternalLink className="h-4 w-4 text-zinc-500 hover:text-zinc-300 transition-colors" />
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-zinc-500">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handlePageChange(Math.max(1, page - 1))}
              disabled={page === 1}
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {getPageNumbers().map((p, i) =>
              p === "..." ? (
                <span key={`ellipsis-${i}`} className="px-1 text-xs text-zinc-500">
                  ...
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => handlePageChange(p)}
                  className={`min-w-7 rounded-md px-1.5 py-1 text-xs transition-colors ${
                    p === page
                      ? "bg-zinc-600 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                  }`}
                >
                  {p}
                </button>
              ),
            )}
            <button
              onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
