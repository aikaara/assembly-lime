import { useState, useEffect } from "react";
import { Box, Plus } from "lucide-react";
import { api } from "../lib/api";
import { EmptyState } from "../components/ui/EmptyState";
import { SandboxCard } from "../components/sandboxes/SandboxCard";
import { LogViewer } from "../components/sandboxes/LogViewer";
import type { Sandbox, Repository, K8sCluster } from "../types";

export function SandboxesPage() {
  const [sandboxes, setSandboxes] = useState<Sandbox[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [clusters, setClusters] = useState<K8sCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [logSandboxId, setLogSandboxId] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [repoId, setRepoId] = useState("");
  const [branch, setBranch] = useState("");
  const [clusterId, setClusterId] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<Sandbox[]>("/sandboxes/"),
      api.get<Repository[]>("/repositories/"),
      api.get<K8sCluster[]>("/k8s-clusters/"),
    ])
      .then(([s, r, c]) => {
        setSandboxes(s);
        setRepos(r);
        setClusters(c.filter((cl) => cl.status === "connected"));
      })
      .catch((err) => console.error("Failed to load:", err))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    if (!repoId || !branch || !clusterId) return;
    setCreating(true);
    setError(null);
    try {
      await api.post("/sandboxes/", {
        repositoryId: Number(repoId),
        branch,
        clusterId: Number(clusterId),
      });
      const data = await api.get<Sandbox[]>("/sandboxes/");
      setSandboxes(data);
      setRepoId("");
      setBranch("");
      setShowCreate(false);
    } catch (err: any) {
      const msg = err?.message || err?.toString() || "Failed to create sandbox";
      setError(msg);
      console.error("Failed to create sandbox:", err);
    } finally {
      setCreating(false);
    }
  }

  async function handleDestroy(id: string) {
    try {
      await api.delete(`/sandboxes/${id}`);
      const data = await api.get<Sandbox[]>("/sandboxes/");
      setSandboxes(data);
    } catch (err) {
      console.error("Failed to destroy sandbox:", err);
    }
  }

  async function handleViewLogs(id: string) {
    setLogSandboxId(id);
    setLoadingLogs(true);
    try {
      const data = await api.get<{ logs: string }>(`/sandboxes/${id}/logs`);
      setLogs(data.logs);
    } catch (err) {
      console.error("Failed to get logs:", err);
      setLogs("Failed to load logs.");
    } finally {
      setLoadingLogs(false);
    }
  }

  // Auto-fill default branch when repo is selected
  function handleRepoChange(value: string) {
    setRepoId(value);
    const repo = repos.find((r) => r.id === value);
    if (repo && !branch) {
      setBranch(repo.defaultBranch);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-zinc-500">Loading...</div>;
  }

  const connectedClusters = clusters;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Dev Sandboxes</h1>
        <button
          onClick={() => { setShowCreate(!showCreate); setError(null); }}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Sandbox
        </button>
      </div>

      {showCreate && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 space-y-3">
          <h3 className="text-sm font-medium text-zinc-200">New Sandbox</h3>

          {connectedClusters.length === 0 && (
            <p className="text-xs text-amber-400">
              No connected K8s clusters. Register a cluster first in the Clusters page.
            </p>
          )}

          <div className="space-y-3">
            <select
              value={clusterId}
              onChange={(e) => setClusterId(e.target.value)}
              className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Select cluster...</option>
              {connectedClusters.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.apiUrl})</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={repoId}
                onChange={(e) => handleRepoChange(e.target.value)}
                className="rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
              >
                <option value="">Select repository...</option>
                {repos.map((r) => (
                  <option key={r.id} value={r.id}>{r.fullName}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Branch (e.g. main, develop)"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !repoId || !branch || !clusterId}
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

      {sandboxes.length === 0 && !showCreate ? (
        <EmptyState
          icon={Box}
          title="No sandboxes"
          description="Create a dev sandbox to run your code in an isolated K8s pod."
        />
      ) : (
        <div className="space-y-3">
          {sandboxes.map((s) => (
            <SandboxCard
              key={s.id}
              sandbox={s}
              onDestroy={handleDestroy}
              onViewLogs={handleViewLogs}
            />
          ))}
        </div>
      )}

      {logSandboxId && (
        <LogViewer logs={logs} loading={loadingLogs} />
      )}
    </div>
  );
}
