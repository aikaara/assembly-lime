import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import {
  GitBranch,
  ExternalLink,
  RefreshCw,
  Bell,
  BellOff,
  Search,
  ChevronLeft,
  ChevronRight,
  Star,
  GitFork,
  Code,
} from "lucide-react";
import { api } from "../lib/api";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
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

function RepoTableSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <Skeleton className="h-4 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 px-4 py-3.5 border-b border-zinc-800/30 last:border-0"
        >
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-20" />
          <div className="flex-1" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-md" />
          <Skeleton className="h-4 w-4" />
        </div>
      ))}
    </div>
  );
}

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
      const params = new URLSearchParams({
        page: String(p),
        limit: String(PAGE_SIZE),
      });
      if (q.trim()) params.set("search", q.trim());
      const res = await api.get<PaginatedResponse>(
        `/repositories?${params}`,
      );
      setRepos(res.data);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch (err) {
      console.error("Failed to load repos:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRepos(1, "");
  }, [loadRepos]);

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
      const result = await api.post<{
        fetched: number;
        imported: number;
        error?: string;
        message?: string;
      }>("/repositories/sync");
      if (result.error === "no_connector") {
        window.location.href = `${API_BASE}/auth/github`;
        return;
      }
      setSyncResult(
        `${result.fetched} repos found, ${result.imported} new imported`,
      );
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
      const result = await api.post<{
        id?: string;
        error?: string;
        message?: string;
      }>(`/repositories/${repoId}/webhook`);
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

  // Initial skeleton loading
  if (loading && repos.length === 0 && !search.trim()) {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
        <Skeleton className="h-10 w-full rounded-lg" />
        <RepoTableSkeleton />
      </div>
    );
  }

  // Empty state (no repos at all)
  if (total === 0 && !search.trim() && !loading) {
    return (
      <div className="p-6 space-y-6">
        <EmptyState
          icon={Code}
          title="No repositories connected"
          description="Connect a GitHub connector to import repositories and start working with AI agents."
          action={
            <div className="flex items-center gap-3">
              <button
                onClick={handleSync}
                disabled={syncing}
                className="inline-flex items-center gap-2 rounded-lg bg-lime-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-lime-400 disabled:opacity-50 transition-colors"
              >
                <RefreshCw
                  className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`}
                />
                {syncing ? "Syncing..." : "Sync Repos"}
              </button>
              <a
                href={`${API_BASE}/auth/github`}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-800 transition-colors"
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

  function getPageNumbers(): (number | "...")[] {
    if (totalPages <= 7)
      return Array.from({ length: totalPages }, (_, i) => i + 1);
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
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Repositories</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {total} repositor{total !== 1 ? "ies" : "y"} connected
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 rounded-lg bg-lime-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-lime-400 disabled:opacity-50 transition-colors"
        >
          <RefreshCw
            className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`}
          />
          {syncing ? "Syncing..." : "Sync Repos"}
        </button>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-300 flex items-center justify-between">
          <span>{syncResult}</span>
          <button
            onClick={() => setSyncResult(null)}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search repositories..."
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-2.5 pl-10 pr-4 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-lime-500/50 focus:outline-none focus:ring-1 focus:ring-lime-500/50 transition-colors"
        />
        {search && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
            {total} result{total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Repo table */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
        {/* Table header */}
        <div className="hidden sm:flex items-center text-[11px] uppercase tracking-wider text-zinc-600 border-b border-zinc-800/50 px-4 py-2.5">
          <span className="flex-1 font-medium">Repository</span>
          <span className="w-20 font-medium text-center">Branch</span>
          <span className="w-20 font-medium text-center">Status</span>
          <span className="w-28 font-medium text-center">Webhook</span>
          <span className="w-8" />
        </div>

        {loading ? (
          <div className="divide-y divide-zinc-800/30">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-48" />
                <div className="flex-1" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-md" />
              </div>
            ))}
          </div>
        ) : repos.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-zinc-500">
            No repositories match "{search}"
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            {repos.map((r) => {
              const hasWebhook = !!r.webhook;
              return (
                <div
                  key={r.id}
                  className="flex items-center px-4 py-3 hover:bg-zinc-800/30 transition-colors group"
                >
                  {/* Repo info */}
                  <Link
                    to={`/repos/${r.id}`}
                    className="flex items-center gap-3 min-w-0 flex-1"
                  >
                    <GitBranch className="h-4 w-4 text-zinc-500 shrink-0" />
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-zinc-200 group-hover:text-lime-400 transition-colors">
                        {r.fullName}
                      </span>
                    </div>
                  </Link>

                  {/* Branch */}
                  <span className="w-20 text-center">
                    <span className="text-xs text-zinc-500 font-mono">
                      {r.defaultBranch}
                    </span>
                  </span>

                  {/* Status */}
                  <span className="w-20 text-center">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs ${
                        r.isEnabled ? "text-lime-400" : "text-zinc-600"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          r.isEnabled ? "bg-lime-500" : "bg-zinc-600"
                        }`}
                      />
                      {r.isEnabled ? "Active" : "Disabled"}
                    </span>
                  </span>

                  {/* Webhook */}
                  <span className="w-28 text-center">
                    {!hasWebhook ? (
                      <button
                        onClick={() => handleSubscribeWebhook(r.id)}
                        disabled={subscribing === r.id}
                        className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800 border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 disabled:opacity-50 transition-colors"
                        title="Subscribe to push, PR, and workflow events"
                      >
                        <BellOff
                          className={`h-3 w-3 ${subscribing === r.id ? "animate-pulse" : ""}`}
                        />
                        {subscribing === r.id ? "..." : "Subscribe"}
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-blue-400">
                        <Bell className="h-3 w-3" />
                        Active
                      </span>
                    )}
                  </span>

                  {/* External link */}
                  <span className="w-8 text-right">
                    <Link to={`/repos/${r.id}`}>
                      <ExternalLink className="h-3.5 w-3.5 text-zinc-600 hover:text-zinc-300 transition-colors" />
                    </Link>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
            <span className="text-xs text-zinc-600">
              Showing {(page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(Math.max(1, page - 1))}
                disabled={page === 1}
                className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 disabled:opacity-30 transition-colors"
              >
                Prev
              </button>
              {getPageNumbers().map((p, i) =>
                p === "..." ? (
                  <span
                    key={`ellipsis-${i}`}
                    className="px-1 text-xs text-zinc-600"
                  >
                    ...
                  </span>
                ) : (
                  <button
                    key={p}
                    onClick={() => handlePageChange(p)}
                    className={`rounded px-2 py-1 text-xs transition-colors ${
                      p === page
                        ? "bg-lime-500/15 text-lime-400"
                        : "text-zinc-500 hover:bg-zinc-800"
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                onClick={() =>
                  handlePageChange(Math.min(totalPages, page + 1))
                }
                disabled={page === totalPages}
                className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 disabled:opacity-30 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
