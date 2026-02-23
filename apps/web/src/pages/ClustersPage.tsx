import { useState, useEffect } from "react";
import { Server, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { EmptyState } from "../components/ui/EmptyState";
import type { K8sCluster } from "../types";

export function ClustersPage() {
  const [clusters, setClusters] = useState<K8sCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [kubeconfig, setKubeconfig] = useState("");
  const [creating, setCreating] = useState(false);
  const [kubeconfigDetectedUrl, setKubeconfigDetectedUrl] = useState("");

  useEffect(() => {
    loadClusters();
  }, []);

  async function loadClusters() {
    setLoading(true);
    try {
      const data = await api.get<K8sCluster[]>("/k8s-clusters/");
      setClusters(data);
    } catch (err) {
      console.error("Failed to load clusters:", err);
    } finally {
      setLoading(false);
    }
  }

  /** Try to extract server URL from pasted kubeconfig YAML. */
  function parseServerFromKubeconfig(yaml: string): string {
    try {
      // Match the first `server:` value in the kubeconfig
      const match = yaml.match(/server:\s*(https?:\/\/\S+)/);
      return match?.[1] ?? "";
    } catch {
      return "";
    }
  }

  function handleKubeconfigChange(value: string) {
    setKubeconfig(value);
    const detected = parseServerFromKubeconfig(value);
    setKubeconfigDetectedUrl(detected);
    // Auto-fill API URL if user hasn't manually entered one
    if (detected && !apiUrl) {
      setApiUrl(detected);
    }
  }

  const canSubmit = !!name && (!!apiUrl || !!kubeconfigDetectedUrl);

  async function handleCreate() {
    if (!canSubmit) return;
    setCreating(true);
    try {
      await api.post("/k8s-clusters", {
        name,
        apiUrl: apiUrl || undefined,
        kubeconfig: kubeconfig || undefined,
      });
      setName("");
      setApiUrl("");
      setKubeconfig("");
      setKubeconfigDetectedUrl("");
      setShowCreate(false);
      await loadClusters();
    } catch (err) {
      console.error("Failed to register cluster:", err);
    } finally {
      setCreating(false);
    }
  }

  async function handleSync(id: string) {
    setSyncing(id);
    try {
      await api.post(`/k8s-clusters/${id}/sync`);
      await loadClusters();
    } catch (err) {
      console.error("Failed to sync cluster:", err);
    } finally {
      setSyncing(null);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/k8s-clusters/${id}`);
      await loadClusters();
    } catch (err) {
      console.error("Failed to delete cluster:", err);
    }
  }

  const statusColors: Record<string, string> = {
    connected: "bg-emerald-500",
    pending: "bg-amber-500",
    error: "bg-red-500",
    disconnected: "bg-zinc-500",
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-zinc-500">Loading...</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">K8s Clusters</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Register Cluster
        </button>
      </div>

      {showCreate && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 space-y-3">
          <h3 className="text-sm font-medium text-zinc-200">New Cluster</h3>
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Cluster name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
            <textarea
              placeholder="Kubeconfig YAML (paste your ~/.kube/config here)"
              value={kubeconfig}
              onChange={(e) => handleKubeconfigChange(e.target.value)}
              rows={4}
              className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none font-mono"
            />
            {kubeconfigDetectedUrl && !apiUrl && (
              <p className="text-xs text-zinc-500">
                Server detected from kubeconfig: <span className="text-zinc-400">{kubeconfigDetectedUrl}</span>
              </p>
            )}
            <input
              type="text"
              placeholder="API URL override (auto-detected from kubeconfig)"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !canSubmit}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
            >
              {creating ? "Registering..." : "Register"}
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

      {clusters.length === 0 && !showCreate ? (
        <EmptyState
          icon={Server}
          title="No clusters"
          description="Register a Kubernetes cluster to create dev sandboxes and manage deployments."
        />
      ) : (
        <div className="space-y-3">
          {clusters.map((c) => (
            <div key={c.id} className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Server className="h-4 w-4 text-zinc-400" />
                  <div>
                    <span className="text-sm font-medium text-zinc-200">{c.name}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`h-2 w-2 rounded-full ${statusColors[c.status] ?? "bg-zinc-500"}`} />
                      <span className="text-xs text-zinc-500">{c.status}</span>
                      <span className="text-xs text-zinc-600">{c.apiUrl}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSync(c.id)}
                    disabled={syncing === c.id}
                    className="rounded-md bg-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${syncing === c.id ? "animate-spin" : ""}`} />
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="rounded-md p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-700 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {c.status === "error" && c.metadataJson && (c.metadataJson as any).error && (
                <p className="mt-2 text-xs text-red-400">
                  {(c.metadataJson as any).error}
                </p>
              )}
              {c.metadataJson && typeof c.metadataJson === "object" && (
                <div className="mt-2 flex gap-4 text-xs text-zinc-500">
                  {(c.metadataJson as any).gitVersion && (
                    <span>Version: {(c.metadataJson as any).gitVersion}</span>
                  )}
                  {(c.metadataJson as any).nodeCount !== undefined && (
                    <span>Nodes: {(c.metadataJson as any).nodeCount}</span>
                  )}
                  {c.lastSyncedAt && (
                    <span>Last synced: {new Date(c.lastSyncedAt).toLocaleString()}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
