import { useState, useEffect } from "react";
import { Globe, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { EmptyState } from "../components/ui/EmptyState";
import type { Domain } from "../types";

export function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const [domainName, setDomainName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadDomains();
  }, []);

  async function loadDomains() {
    setLoading(true);
    try {
      const data = await api.get<Domain[]>("/domains");
      setDomains(data);
    } catch (err) {
      console.error("Failed to load domains:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!domainName) return;
    setCreating(true);
    try {
      await api.post("/domains", { domain: domainName });
      setDomainName("");
      setShowCreate(false);
      await loadDomains();
    } catch (err) {
      console.error("Failed to create domain:", err);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/domains/${id}`);
      await loadDomains();
    } catch (err) {
      console.error("Failed to delete domain:", err);
    }
  }

  const statusColors: Record<string, string> = {
    active: "bg-emerald-500",
    provisioning: "bg-amber-500",
    pending: "bg-blue-500",
    error: "bg-red-500",
    deleted: "bg-zinc-600",
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-zinc-500">Loading...</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Domains</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Domain
        </button>
      </div>

      {showCreate && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 space-y-3">
          <h3 className="text-sm font-medium text-zinc-200">New Domain</h3>
          <input
            type="text"
            placeholder="example.assemblylime.dev"
            value={domainName}
            onChange={(e) => setDomainName(e.target.value)}
            className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !domainName}
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

      {domains.length === 0 && !showCreate ? (
        <EmptyState
          icon={Globe}
          title="No domains"
          description="Add custom domains for your preview deployments and sandboxes."
        />
      ) : (
        <div className="space-y-3">
          {domains.filter((d) => d.status !== "deleted").map((d) => (
            <div key={d.id} className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Globe className="h-4 w-4 text-zinc-400" />
                <div>
                  <span className="text-sm font-medium text-zinc-200">{d.domain}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`h-2 w-2 rounded-full ${statusColors[d.status] ?? "bg-zinc-500"}`} />
                    <span className="text-xs text-zinc-500">{d.status}</span>
                    {d.tlsCertSecret && (
                      <span className="text-xs text-emerald-500">TLS</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleDelete(d.id)}
                className="rounded-md p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-700 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
