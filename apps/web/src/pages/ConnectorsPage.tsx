import { useState, useEffect } from "react";
import { Link2, Plus, Trash2, GitBranch, Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { EmptyState } from "../components/ui/EmptyState";

type Connector = {
  id: string;
  provider: number;
  externalOrg: string | null;
  authType: number;
  scopes: string[];
  status: number;
  createdAt: string;
};

type RemoteRepo = {
  externalRepoId: number;
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  language: string | null;
  updatedAt: string;
};

const API_BASE = "/api";

export function ConnectorsPage() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState<string | null>(null);
  const [remoteRepos, setRemoteRepos] = useState<RemoteRepo[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Create form
  const [token, setToken] = useState("");
  const [org, setOrg] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadConnectors();
  }, []);

  async function loadConnectors() {
    setLoading(true);
    try {
      const data = await api.get<Connector[]>("/connectors");
      setConnectors(data);
    } catch (err) {
      console.error("Failed to load connectors:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!token) return;
    setCreating(true);
    try {
      await api.post("/connectors", {
        provider: 1,
        authType: 1,
        accessToken: token,
        externalOrg: org || undefined,
        scopes: ["repo"],
      });
      setToken("");
      setOrg("");
      setShowCreate(false);
      await loadConnectors();
    } catch (err) {
      console.error("Failed to create connector:", err);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    try {
      await api.delete(`/connectors/${id}`);
      await loadConnectors();
    } catch (err) {
      console.error("Failed to revoke connector:", err);
    }
  }

  async function handleSync(connectorId: string) {
    setSyncing(connectorId);
    setSyncResult(null);
    try {
      const result = await api.post<{ fetched: number; imported: number }>(
        `/connectors/${connectorId}/sync`
      );
      setSyncResult(`Synced: ${result.fetched} repos found, ${result.imported} new imported`);
    } catch (err) {
      console.error("Failed to sync repos:", err);
      setSyncResult("Sync failed");
    } finally {
      setSyncing(null);
    }
  }

  async function loadRemoteRepos(connectorId: string) {
    setSelectedConnector(connectorId);
    setLoadingRepos(true);
    setSelectedRepos(new Set());
    try {
      const repos = await api.get<RemoteRepo[]>(`/connectors/${connectorId}/repos/remote`);
      setRemoteRepos(repos);
    } catch (err) {
      console.error("Failed to load remote repos:", err);
    } finally {
      setLoadingRepos(false);
    }
  }

  async function handleImport() {
    if (!selectedConnector || selectedRepos.size === 0) return;
    setImporting(true);
    try {
      const repos = remoteRepos
        .filter((r) => selectedRepos.has(r.fullName))
        .map((r) => ({
          externalRepoId: r.externalRepoId,
          owner: r.owner,
          name: r.name,
          fullName: r.fullName,
          cloneUrl: r.cloneUrl,
          defaultBranch: r.defaultBranch,
        }));
      await api.post(`/connectors/${selectedConnector}/repos/import`, { repos });
      setSelectedRepos(new Set());
      setRemoteRepos([]);
      setSelectedConnector(null);
    } catch (err) {
      console.error("Failed to import repos:", err);
    } finally {
      setImporting(false);
    }
  }

  function toggleRepo(fullName: string) {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-zinc-500">Loading...</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Connectors</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Connector
        </button>
      </div>

      {showCreate && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 space-y-3">
          <h3 className="text-sm font-medium text-zinc-200">New GitHub Connector</h3>
          <div className="space-y-2">
            <input
              type="password"
              placeholder="GitHub Personal Access Token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Organization (optional, leave blank for personal repos)"
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !token}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-md bg-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {connectors.length === 0 && !showCreate ? (
        <EmptyState
          icon={Link2}
          title="No connectors"
          description="Connect your GitHub account to automatically import all your repositories."
          action={
            <a
              href={`${API_BASE}/auth/github`}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
            >
              <GitBranch className="h-4 w-4" />
              Connect GitHub
            </a>
          }
        />
      ) : (
        <div className="space-y-3">
          {connectors.map((c) => (
            <div key={c.id} className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-zinc-400" />
                  <span className="text-sm font-medium text-zinc-200">
                    GitHub {c.externalOrg ? `(${c.externalOrg})` : "(Personal)"}
                  </span>
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                </div>
                <p className="text-xs text-zinc-500 mt-1">
                  Created {new Date(c.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSync(c.id)}
                  disabled={syncing === c.id}
                  className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncing === c.id ? "animate-spin" : ""}`} />
                  {syncing === c.id ? "Syncing..." : "Sync Repos"}
                </button>
                <button
                  onClick={() => loadRemoteRepos(c.id)}
                  className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 transition-colors"
                >
                  Browse Repos
                </button>
                <button
                  onClick={() => handleRevoke(c.id)}
                  className="rounded-md p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-700 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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

      {selectedConnector && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-200">Remote Repositories</h3>
            {selectedRepos.size > 0 && (
              <button
                onClick={handleImport}
                disabled={importing}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
              >
                {importing ? "Importing..." : `Import ${selectedRepos.size} repo(s)`}
              </button>
            )}
          </div>

          {loadingRepos ? (
            <div className="flex items-center gap-2 text-zinc-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading repos from GitHub...
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-1">
              {remoteRepos.map((r) => (
                <label
                  key={r.fullName}
                  className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-zinc-700/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedRepos.has(r.fullName)}
                    onChange={() => toggleRepo(r.fullName)}
                    className="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-zinc-200">{r.fullName}</span>
                    {r.description && (
                      <p className="text-xs text-zinc-500 truncate">{r.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-zinc-500 shrink-0">
                    {r.language && <span>{r.language}</span>}
                    {r.private && <span className="text-amber-500">private</span>}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
