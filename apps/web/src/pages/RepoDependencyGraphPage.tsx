import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { RepoNode, type RepoNodeType } from "../components/repos/RepoNode";
import type {
  DependencyGraphResponse,
  DependencyScanStatus,
} from "../types";

const nodeTypes = { repo: RepoNode };

const EDGE_COLORS: Record<string, string> = {
  package: "#22c55e",
  api_consumer: "#3b82f6",
  sdk_usage: "#a855f7",
  docker_ref: "#f59e0b",
  submodule: "#ef4444",
  shared_config: "#06b6d4",
};

const EDGE_LABELS: Record<string, string> = {
  package: "Package",
  api_consumer: "API",
  sdk_usage: "SDK",
  docker_ref: "Docker",
  submodule: "Submodule",
  shared_config: "Config",
};

function layoutNodes(repoNodes: DependencyGraphResponse["nodes"]): Node[] {
  const cols = Math.ceil(Math.sqrt(repoNodes.length));
  const spacingX = 280;
  const spacingY = 160;

  return repoNodes.map((repo, i): RepoNodeType => ({
    id: repo.id,
    type: "repo",
    position: {
      x: (i % cols) * spacingX,
      y: Math.floor(i / cols) * spacingY,
    },
    data: {
      fullName: repo.fullName,
      isEnabled: repo.isEnabled,
      depCount: 0, // will be computed below
      hasFork: !!repo.forkOwner,
    },
  }));
}

export function RepoDependencyGraphPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState<RepoNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<DependencyScanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/repository-dependencies", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to fetch graph: ${res.status}`);
      const data: DependencyGraphResponse = await res.json();

      // Count deps per node
      const depCountMap = new Map<string, number>();
      for (const edge of data.edges) {
        depCountMap.set(
          edge.sourceRepositoryId,
          (depCountMap.get(edge.sourceRepositoryId) ?? 0) + 1
        );
        depCountMap.set(
          edge.targetRepositoryId,
          (depCountMap.get(edge.targetRepositoryId) ?? 0) + 1
        );
      }

      const flowNodes = layoutNodes(data.nodes);
      // Inject dep counts
      for (const node of flowNodes) {
        node.data.depCount = depCountMap.get(node.id) ?? 0;
      }

      const flowEdges: Edge[] = data.edges.map((e) => ({
        id: e.id,
        source: e.sourceRepositoryId,
        target: e.targetRepositoryId,
        label: EDGE_LABELS[e.dependencyType] ?? e.dependencyType,
        style: { stroke: EDGE_COLORS[e.dependencyType] ?? "#71717a" },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: EDGE_COLORS[e.dependencyType] ?? "#71717a",
        },
        animated: e.confidence < 70,
      }));

      setNodes(flowNodes);
      setEdges(flowEdges);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  const fetchScanStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/repository-dependencies/scan-status", {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      setScanStatus(data.scan);

      if (data.scan?.status === "running" || data.scan?.status === "pending") {
        setScanning(true);
      } else {
        setScanning(false);
      }
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    fetchGraph();
    fetchScanStatus();
  }, [fetchGraph, fetchScanStatus]);

  // Poll scan status while scanning
  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(async () => {
      await fetchScanStatus();
      // If scan completed, refresh graph
      const res = await fetch("/api/repository-dependencies/scan-status", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.scan?.status === "completed" || data.scan?.status === "failed") {
          setScanning(false);
          fetchGraph();
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [scanning, fetchGraph, fetchScanStatus]);

  const handleScan = async () => {
    try {
      setScanning(true);
      const res = await fetch("/api/repository-dependencies/scan", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Scan failed: ${res.status}`);
      await fetchScanStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setScanning(false);
    }
  };

  const legendItems = useMemo(
    () =>
      Object.entries(EDGE_LABELS).map(([type, label]) => ({
        type,
        label,
        color: EDGE_COLORS[type],
      })),
    []
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        <span className="ml-2 text-zinc-400">Loading dependency graph...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-zinc-100">
            Repository Dependencies
          </h2>
          {scanStatus && (
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                scanStatus.status === "completed"
                  ? "bg-emerald-900/50 text-emerald-300"
                  : scanStatus.status === "failed"
                    ? "bg-red-900/50 text-red-300"
                    : scanStatus.status === "running"
                      ? "bg-amber-900/50 text-amber-300"
                      : "bg-zinc-700 text-zinc-300"
              }`}
            >
              {scanStatus.status === "completed"
                ? `${scanStatus.depsFound} dependencies found`
                : scanStatus.status === "running"
                  ? "Scanning..."
                  : scanStatus.status === "failed"
                    ? "Scan failed"
                    : "Pending"}
            </span>
          )}
        </div>

        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {scanning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {scanning ? "Scanning..." : "Scan Dependencies"}
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-red-900/30 border border-red-800 px-3 py-2 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Graph */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          className="bg-zinc-950"
        >
          <Background color="#27272a" gap={20} />
          <Controls className="!bg-zinc-800 !border-zinc-700 !rounded-lg [&>button]:!bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:!text-zinc-300 [&>button:hover]:!bg-zinc-700" />
          <MiniMap
            nodeColor="#3f3f46"
            maskColor="rgba(0,0,0,0.6)"
            className="!bg-zinc-900 !border-zinc-700 !rounded-lg"
          />
        </ReactFlow>

        {/* Legend */}
        <div className="absolute bottom-4 left-4 rounded-lg border border-zinc-700 bg-zinc-800/90 backdrop-blur px-3 py-2 z-10">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
            Dependency Types
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {legendItems.map((item) => (
              <div key={item.type} className="flex items-center gap-1.5">
                <div
                  className="h-2 w-4 rounded-sm"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-[11px] text-zinc-300">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Empty state */}
        {nodes.length === 0 && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-zinc-400 mb-2">No repositories found</p>
              <p className="text-zinc-500 text-sm">
                Import repositories first, then scan for dependencies.
              </p>
            </div>
          </div>
        )}

        {nodes.length > 0 && edges.length === 0 && !loading && !scanning && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 rounded-lg border border-zinc-700 bg-zinc-800/90 backdrop-blur px-4 py-2">
            <p className="text-sm text-zinc-400">
              No dependencies detected yet. Click "Scan Dependencies" to analyze repos.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
