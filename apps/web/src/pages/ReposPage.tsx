import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { GitBranch, ExternalLink, RefreshCw, Bell, BellOff } from "lucide-react";
import { api } from "../lib/api";
import { EmptyState } from "../components/ui/EmptyState";
import type { Repository } from "../types";

const API_BASE = "/api";

type WebhookInfo = {
  id: string;
  events: string[];
};

export function ReposPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [webhookMap, setWebhookMap] = useState<Record<string, WebhookInfo[]>>({});
  const [subscribing, setSubscribing] = useState<string | null>(null);

  useEffect(() => {
    loadRepos();
  }, []);

  async function loadRepos() {
    setLoading(true);
    try {
      const data = await api.get<Repository[]>("/repositories/");
      setRepos(data);
      // Load webhook status for each repo
      const whMap: Record<string, WebhookInfo[]> = {};
      await Promise.all(
        data.map(async (r) => {
          try {
            const wh = await api.get<WebhookInfo[]>(`/repositories/${r.id}/webhook`);
            if (wh.length > 0) whMap[r.id] = wh;
          } catch {
            // ignore
          }
        })
      );
      setWebhookMap(whMap);
    } catch (err) {
      console.error("Failed to load repos:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api.post<{ fetched: number; imported: number; error?: string; message?: string }>(
        "/repositories/sync"
      );
      if (result.error === "no_connector") {
        // No connector — re-authenticate to create one
        window.location.href = `${API_BASE}/auth/github`;
        return;
      }
      setSyncResult(`${result.fetched} repos found, ${result.imported} new imported`);
      await loadRepos();
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
        await loadRepos();
      }
    } catch (err) {
      console.error("Failed to subscribe webhook:", err);
    } finally {
      setSubscribing(null);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-zinc-500">Loading...</div>;
  }

  if (repos.length === 0) {
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

      <div className="space-y-2">
        {repos.map((r) => {
          const hasWebhook = !!webhookMap[r.id];
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
        })}
      </div>
    </div>
  );
}
