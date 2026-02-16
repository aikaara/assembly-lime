import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Key, Plus, Save, Trash2, Variable } from "lucide-react";
import { api } from "../../lib/api";
import type { Repository, EnvVarSet, EnvVar } from "../../types";

type Props = {
  repos: Repository[];
};

type VarDraft = {
  key: string;
  value: string;
  isSecret: boolean;
  dirty: boolean;
};

export function EnvVarsPanel({ repos }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [sets, setSets] = useState<EnvVarSet[]>([]);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [vars, setVars] = useState<VarDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newSetName, setNewSetName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Load sets when repo changes
  useEffect(() => {
    if (!selectedRepoId) {
      setSets([]);
      setActiveSetId(null);
      return;
    }
    setLoading(true);
    api
      .get<EnvVarSet[]>(`/env-var-sets/?scopeType=project&scopeId=${selectedRepoId}`)
      .then((data) => {
        setSets(data);
        if (data.length > 0 && !activeSetId) {
          setActiveSetId(data[0]!.id);
        }
      })
      .catch(() => setSets([]))
      .finally(() => setLoading(false));
  }, [selectedRepoId]);

  // Load vars when active set changes
  useEffect(() => {
    if (!activeSetId) {
      setVars([]);
      return;
    }
    api
      .get<EnvVar[]>(`/env-var-sets/${activeSetId}/vars`)
      .then((data) =>
        setVars(
          data.map((v) => ({
            key: v.key,
            value: "",
            isSecret: v.isSecret,
            dirty: false,
          })),
        ),
      )
      .catch(() => setVars([]));
  }, [activeSetId]);

  async function handleScanConfigs() {
    if (!selectedRepoId) return;
    setScanning(true);
    setMessage(null);
    try {
      const configs = await api.post<Array<{ filePath: string; detectedKeys: string[] }>>(
        `/repositories/${selectedRepoId}/scan-configs`,
      );
      const totalKeys = configs.reduce((acc, c) => acc + c.detectedKeys.length, 0);
      setMessage({ text: `Scanned — found ${totalKeys} env keys across ${configs.length} config file(s)`, type: "success" });
      // Reload sets
      const data = await api.get<EnvVarSet[]>(`/env-var-sets/?scopeType=project&scopeId=${selectedRepoId}`);
      setSets(data);
      if (data.length > 0) setActiveSetId(data[0]!.id);
    } catch {
      setMessage({ text: "Failed to scan repository configs", type: "error" });
    } finally {
      setScanning(false);
    }
  }

  async function handleCreateSet() {
    if (!selectedRepoId || !newSetName.trim()) return;
    try {
      const row = await api.post<EnvVarSet>("/env-var-sets/", {
        scopeType: "project",
        scopeId: Number(selectedRepoId),
        name: newSetName.trim(),
      });
      setSets((prev) => [...prev, row]);
      setActiveSetId(row.id);
      setNewSetName("");
      setShowCreate(false);
    } catch {
      setMessage({ text: "Failed to create env var set", type: "error" });
    }
  }

  async function handleDeleteSet(setId: string) {
    try {
      await api.delete(`/env-var-sets/${setId}`);
      setSets((prev) => prev.filter((s) => s.id !== setId));
      if (activeSetId === setId) {
        setActiveSetId(null);
        setVars([]);
      }
    } catch {
      setMessage({ text: "Failed to delete env var set", type: "error" });
    }
  }

  function updateVar(index: number, field: keyof VarDraft, value: string | boolean) {
    setVars((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [field]: value, dirty: true } : v)),
    );
  }

  function addVar() {
    setVars((prev) => [...prev, { key: "", value: "", isSecret: true, dirty: true }]);
  }

  function removeVar(index: number) {
    setVars((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!activeSetId) return;
    const dirtyVars = vars.filter((v) => v.dirty && v.key.trim() && v.value.trim());
    if (dirtyVars.length === 0) {
      setMessage({ text: "No changes to save (fill in values for keys you want to set)", type: "error" });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.post(`/env-var-sets/${activeSetId}/vars/bulk`, {
        vars: dirtyVars.map((v) => ({
          key: v.key.trim(),
          value: v.value,
          isSecret: v.isSecret,
        })),
      });
      setMessage({ text: `Saved ${dirtyVars.length} variable(s) (encrypted at rest)`, type: "success" });
      // Reload vars
      const data = await api.get<EnvVar[]>(`/env-var-sets/${activeSetId}/vars`);
      setVars(
        data.map((v) => ({
          key: v.key,
          value: "",
          isSecret: v.isSecret,
          dirty: false,
        })),
      );
    } catch {
      setMessage({ text: "Failed to save variables", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  function toggleReveal(key: string) {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleDeleteVar(index: number) {
    const v = vars[index];
    if (!v) return;
    // If it has an ID (saved), delete from server
    // For now just remove from local state
    removeVar(index);
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Variable className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">Environment Variables</span>
          {sets.length > 0 && (
            <span className="text-[10px] bg-zinc-700 text-zinc-400 rounded px-1.5 py-0.5">
              {sets.length} set{sets.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        ) : (
          <ChevronRight className="h-4 w-4 text-zinc-500" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-zinc-700 px-4 py-3 space-y-3">
          {/* Repo selector */}
          <div className="flex gap-2">
            <select
              value={selectedRepoId}
              onChange={(e) => {
                setSelectedRepoId(e.target.value);
                setActiveSetId(null);
                setMessage(null);
              }}
              className="flex-1 rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Select repository...</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fullName}
                </option>
              ))}
            </select>
            {selectedRepoId && (
              <button
                onClick={handleScanConfigs}
                disabled={scanning}
                className="rounded-md bg-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-600 transition-colors disabled:opacity-50"
              >
                {scanning ? "Scanning..." : "Scan .env"}
              </button>
            )}
          </div>

          {message && (
            <p className={`text-xs ${message.type === "success" ? "text-emerald-400" : "text-red-400"}`}>
              {message.text}
            </p>
          )}

          {selectedRepoId && (
            <>
              {/* Set tabs */}
              <div className="flex items-center gap-2 flex-wrap">
                {sets.map((s) => (
                  <div key={s.id} className="flex items-center">
                    <button
                      onClick={() => setActiveSetId(s.id)}
                      className={`rounded-l-md px-3 py-1 text-xs transition-colors ${
                        activeSetId === s.id
                          ? "bg-emerald-600/30 text-emerald-400 border border-emerald-500/40"
                          : "bg-zinc-700 text-zinc-400 border border-zinc-600 hover:bg-zinc-600"
                      }`}
                    >
                      {s.name}
                    </button>
                    <button
                      onClick={() => handleDeleteSet(s.id)}
                      className="rounded-r-md border border-l-0 border-zinc-600 bg-zinc-700 px-1.5 py-1 text-zinc-500 hover:text-red-400 hover:bg-zinc-600 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {!showCreate ? (
                  <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-1 rounded-md bg-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-600 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    New Set
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <input
                      value={newSetName}
                      onChange={(e) => setNewSetName(e.target.value)}
                      placeholder="Set name..."
                      className="rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none w-32"
                      onKeyDown={(e) => e.key === "Enter" && handleCreateSet()}
                      autoFocus
                    />
                    <button
                      onClick={handleCreateSet}
                      disabled={!newSetName.trim()}
                      className="rounded-md bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => { setShowCreate(false); setNewSetName(""); }}
                      className="rounded-md bg-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-600 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {/* Var editor */}
              {activeSetId && (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 text-[10px] text-zinc-500 uppercase tracking-wider px-1">
                    <span>Key</span>
                    <span>Value</span>
                    <span>Secret</span>
                    <span />
                  </div>
                  {vars.map((v, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
                      <input
                        value={v.key}
                        onChange={(e) => updateVar(i, "key", e.target.value)}
                        placeholder="KEY_NAME"
                        className="rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none font-mono"
                      />
                      <div className="relative">
                        <input
                          type={v.isSecret && !revealedKeys.has(v.key) ? "password" : "text"}
                          value={v.value}
                          onChange={(e) => updateVar(i, "value", e.target.value)}
                          placeholder={v.dirty ? "enter value..." : "(encrypted)"}
                          className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1.5 pr-7 text-xs text-zinc-200 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none font-mono"
                        />
                        {v.isSecret && (
                          <button
                            onClick={() => toggleReveal(v.key)}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                          >
                            {revealedKeys.has(v.key) ? (
                              <EyeOff className="h-3 w-3" />
                            ) : (
                              <Eye className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => updateVar(i, "isSecret", !v.isSecret)}
                        className={`rounded-md p-1.5 transition-colors ${
                          v.isSecret
                            ? "text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                            : "text-zinc-500 hover:bg-zinc-700"
                        }`}
                        title={v.isSecret ? "Secret (masked)" : "Plain (visible)"}
                      >
                        <Key className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => handleDeleteVar(i)}
                        className="rounded-md p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-700 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={addVar}
                      className="flex items-center gap-1 rounded-md bg-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-600 transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      Add Variable
                    </button>
                    {vars.some((v) => v.dirty) && (
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                      >
                        <Save className="h-3 w-3" />
                        {saving ? "Saving..." : "Save Changes"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {loading && <p className="text-xs text-zinc-500">Loading...</p>}
        </div>
      )}
    </div>
  );
}
