import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, GitBranch, ToggleLeft, ToggleRight } from "lucide-react";
import { api } from "../lib/api";
import { FileTree } from "../components/repos/FileTree";
import { ConfigDetection } from "../components/repos/ConfigDetection";
import type { Repository, FileTreeEntry, RepoConfig } from "../types";

export function RepoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [repo, setRepo] = useState<Repository | null>(null);
  const [tree, setTree] = useState<FileTreeEntry[]>([]);
  const [configs, setConfigs] = useState<RepoConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.get<Repository>(`/repositories/${id}`),
      api.get<FileTreeEntry[]>(`/repositories/${id}/tree`),
      api.get<RepoConfig[]>(`/repositories/${id}/configs`),
    ])
      .then(([repoData, treeData, configData]) => {
        setRepo(repoData);
        setTree(treeData);
        setConfigs(configData);
      })
      .catch((err) => console.error("Failed to load repo:", err))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleScan() {
    if (!id) return;
    setScanning(true);
    try {
      await api.post(`/repositories/${id}/scan-configs`);
      const configData = await api.get<RepoConfig[]>(`/repositories/${id}/configs`);
      setConfigs(configData);
    } catch (err) {
      console.error("Failed to scan configs:", err);
    } finally {
      setScanning(false);
    }
  }

  async function handleToggleEnabled() {
    if (!id || !repo) return;
    try {
      const res = await api.patch<{ id: string; isEnabled: boolean }>(`/repositories/${id}`, {
        isEnabled: !repo.isEnabled,
      });
      setRepo({ ...repo, isEnabled: res.isEnabled });
    } catch (err) {
      console.error("Failed to toggle repo:", err);
    }
  }

  async function handleSelectFile(path: string) {
    if (!id) return;
    setSelectedFile(path);
    try {
      const data = await api.get<{ content?: string; encoding?: string }>(
        `/repositories/${id}/file?path=${encodeURIComponent(path)}`
      );
      if (data.content && data.encoding === "base64") {
        setFileContent(atob(data.content));
      } else {
        setFileContent(null);
      }
    } catch (err) {
      console.error("Failed to load file:", err);
      setFileContent(null);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-zinc-500">Loading...</div>;
  }

  if (!repo) {
    return (
      <div className="p-6">
        <p className="text-zinc-500">Repository not found.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800 px-6 py-4">
        <Link
          to="/repos"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200 mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          Repositories
        </Link>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GitBranch className="h-5 w-5 text-zinc-400" />
            <h2 className="text-lg font-semibold text-zinc-100">{repo.fullName}</h2>
            <span className="text-xs text-zinc-500">Branch: {repo.defaultBranch}</span>
          </div>
          <button
            onClick={handleToggleEnabled}
            className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
          >
            {repo.isEnabled ? (
              <ToggleRight className="h-5 w-5 text-lime-500" />
            ) : (
              <ToggleLeft className="h-5 w-5 text-zinc-600" />
            )}
            {repo.isEnabled ? "Enabled" : "Disabled"}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* File tree */}
        <div className="w-72 border-r border-zinc-800 overflow-y-auto p-3">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-2">
            Files
          </h3>
          <FileTree
            repoId={id!}
            entries={tree}
            currentRef={repo.defaultBranch}
            onSelectFile={handleSelectFile}
          />
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <ConfigDetection configs={configs} scanning={scanning} onScan={handleScan} />

          {selectedFile && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-zinc-200 font-mono">{selectedFile}</h3>
              {fileContent ? (
                <pre className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-xs text-zinc-300 overflow-x-auto max-h-96">
                  {fileContent}
                </pre>
              ) : (
                <p className="text-xs text-zinc-500">Unable to display file content.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
