import { useState, useEffect } from "react";
import { Box, Cloud, Plus, Server } from "lucide-react";
import { api } from "../lib/api";
import { EmptyState } from "../components/ui/EmptyState";
import { SandboxCard } from "../components/sandboxes/SandboxCard";
import { LogViewer } from "../components/sandboxes/LogViewer";
import { EnvVarsPanel } from "../components/sandboxes/EnvVarsPanel";
import type { Sandbox, Repository, K8sCluster, EnvVarSet } from "../types";

type SandboxConfig = { provider: string; isDaytona: boolean };

export function SandboxesPage() {
  const [sandboxes, setSandboxes] = useState<Sandbox[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [clusters, setClusters] = useState<K8sCluster[]>([]);
  const [envVarSets, setEnvVarSets] = useState<EnvVarSet[]>([]);
  const [config, setConfig] = useState<SandboxConfig | null>(null);
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
  const [envVarSetId, setEnvVarSetId] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<Sandbox[]>("/sandboxes/"),
      api.get<Repository[]>("/repositories/"),
      api.get<K8sCluster[]>("/k8s-clusters/"),
      api.get<SandboxConfig>("/sandboxes/config"),
    ])
      .then(([s, r, c, cfg]) => {
        setSandboxes(s);
        setRepos(r);
        setClusters(c.filter((cl) => cl.status === "connected"));
        setConfig(cfg);
      })
      .catch((err) => console.error("Failed to load:", err))
      .finally(() => setLoading(false));
  }, []);

  // Load env var sets when repo changes
  useEffect(() => {
    if (!repoId) {
      setEnvVarSets([]);
      return;
    }
    api
      .get<EnvVarSet[]>(`/env-var-sets/?scopeType=project&scopeId=${repoId}`)
      .then(setEnvVarSets)
      .catch(() => setEnvVarSets([]));
  }, [repoId]);

  const isDaytona = config?.isDaytona ?? false;

  async function handleCreate() {
    if (!repoId || !branch) return;
    if (!isDaytona && !clusterId) return;
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        repositoryId: Number(repoId),
        branch,
      };
      if (isDaytona) {
        body.provider = "daytona";
      } else {
        body.clusterId = Number(clusterId);
      }
      if (envVarSetId) {
        body.envVarSetId = Number(envVarSetId);
      }
      await api.post("/sandboxes/", body);
      const data = await api.get<Sandbox[]>("/sandboxes/");
      setSandboxes(data);
      setRepoId("");
      setBranch("");
      setEnvVarSetId("");
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
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-zinc-100">Dev Sandboxes</h1>
          {config && (
            <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium ${
              isDaytona
                ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
            }`}>
              {isDaytona ? <Cloud className="h-2.5 w-2.5" /> : <Server className="h-2.5 w-2.5" />}
              {isDaytona ? "Daytona" : "K8s"}
            </span>
          )}
        </div>
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

          {!isDaytona && connectedClusters.length === 0 && (
            <p className="text-xs text-amber-400">
              No connected K8s clusters. Register a cluster first in the Clusters page.
            </p>
          )}

          <div className="space-y-3">
            {!isDaytona && (
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
            )}
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
            {envVarSets.length > 0 && (
              <select
                value={envVarSetId}
                onChange={(e) => setEnvVarSetId(e.target.value)}
                className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
              >
                <option value="">No environment variables</option>
                {envVarSets.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !repoId || !branch || (!isDaytona && !clusterId)}
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
          description={isDaytona
            ? "Create a dev sandbox powered by Daytona, or trigger an agent run to auto-create one."
            : "Create a dev sandbox to run your code in an isolated K8s pod."
          }
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

      {/* Environment Variables management panel */}
      <EnvVarsPanel repos={repos} />
    </div>
  );
}
