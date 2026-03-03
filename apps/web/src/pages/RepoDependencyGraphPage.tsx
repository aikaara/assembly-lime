import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Edge,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, RefreshCw, AlertCircle, Network } from "lucide-react";
import { RepoNode, type RepoNodeType } from "../components/repos/RepoNode";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import type {
  DependencyGraphResponse,
  DependencyScanStatus,
} from "../types";

const nodeTypes = { repo: RepoNode };

const EDGE_COLORS: Record<string, string> = {
  package: "#84cc16", // lime-500
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

function layoutNodes(
  repoNodes: DependencyGraphResponse["nodes"],
): RepoNodeType[] {
  const cols = Math.ceil(Math.sqrt(repoNodes.length));
  const spacingX = 300;
  const spacingY = 180;

  return repoNodes.map(
    (repo, i): RepoNodeType => ({
      id: repo.id,
      type: "repo",
      position: {
        x: (i % cols) * spacingX,
        y: Math.floor(i / cols) * spacingY,
      },
      data: {
        fullName: repo.fullName,
        isEnabled: repo.isEnabled,
        depCount: 0,
        hasFork: !!repo.forkOwner,
      },
    }),
  );
}

function GraphSkeleton() {
  return (
    <div className="flex items-center justify-center h-full bg-zinc-950">
      <div className="text-center">
        <div className="mb-4 rounded-2xl bg-zinc-900 border border-zinc-800 p-4 inline-block">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
        <p className="text-sm text-zinc-400">Loading dependency graph...</p>
        <p className="text-xs text-zinc-600 mt-1">
          Fetching repository relationships
        </p>
      </div>
    </div>
  );
}

export function RepoDependencyGraphPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState<RepoNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<DependencyScanStatus | null>(
    null,
  );
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

      const depCountMap = new Map<string, number>();
      for (const edge of data.edges) {
        depCountMap.set(
          edge.sourceRepositoryId,
          (depCountMap.get(edge.sourceRepositoryId) ?? 0) + 1,
        );
        depCountMap.set(
          edge.targetRepositoryId,
          (depCountMap.get(edge.targetRepositoryId) ?? 0) + 1,
        );
      }

      const flowNodes = layoutNodes(data.nodes);
      for (const node of flowNodes) {
        node.data.depCount = depCountMap.get(node.id) ?? 0;
      }

      const flowEdges: Edge[] = data.edges.map((e) => ({
        id: e.id,
        source: e.sourceRepositoryId,
        target: e.targetRepositoryId,
        label: EDGE_LABELS[e.dependencyType] ?? e.dependencyType,
        style: { stroke: EDGE_COLORS[e.dependencyType] ?? "#71717a" },
        labelStyle: { fill: "#a1a1aa", fontSize: 10, fontWeight: 500 },
        labelBgStyle: { fill: "#18181b", fillOpacity: 0.8 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
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

      if (
        data.scan?.status === "running" ||
        data.scan?.status === "pending"
      ) {
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
      const res = await fetch("/api/repository-dependencies/scan-status", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (
          data.scan?.status === "completed" ||
          data.scan?.status === "failed"
        ) {
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
    [],
  );

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-9 w-40 rounded-lg" />
        </div>
        <GraphSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-zinc-100">
            Repository Dependencies
          </h2>
          {scanStatus && (
            <span
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${
                scanStatus.status === "completed"
                  ? "bg-lime-500/10 text-lime-400"
                  : scanStatus.status === "failed"
                    ? "bg-red-500/10 text-red-400"
                    : scanStatus.status === "running"
                      ? "bg-amber-500/10 text-amber-400"
                      : "bg-zinc-700/50 text-zinc-400"
              }`}
            >
              {scanStatus.status === "running" && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              {scanStatus.status === "completed" && (
                <span className="h-1.5 w-1.5 rounded-full bg-lime-400" />
              )}
              {scanStatus.status === "completed"
                ? `${scanStatus.depsFound} dependencies found`
                : scanStatus.status === "running"
                  ? "Scanning..."
                  : scanStatus.status === "failed"
                    ? "Scan failed"
                    : "Pending"}
            </span>
          )}
          {edges.length > 0 && (
            <span className="text-xs text-zinc-600">
              {nodes.length} repos &middot; {edges.length} connections
            </span>
          )}
        </div>

        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-2 rounded-lg bg-lime-500 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-lime-400 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {scanning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {scanning
            ? "Scanning..."
            : edges.length > 0
              ? "Rescan"
              : "Scan Dependencies"}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-3 flex items-center gap-2 rounded-lg bg-red-900/20 border border-red-800/50 px-4 py-2.5 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Dismiss
          </button>
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
        {edges.length > 0 && (
          <div className="absolute bottom-4 left-4 rounded-xl border border-zinc-700 bg-zinc-800/90 backdrop-blur px-4 py-3 z-10">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-2">
              Dependency Types
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {legendItems.map((item) => (
                <div key={item.type} className="flex items-center gap-1.5">
                  <div
                    className="h-2 w-5 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-[11px] text-zinc-300">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty: no repos at all */}
        {nodes.length === 0 && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80">
            <EmptyState
              icon={Network}
              title="No repositories found"
              description="Import repositories first, then scan for dependencies to visualize the graph."
              action={
                <a
                  href="/repos"
                  className="inline-flex items-center gap-2 rounded-lg bg-lime-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-lime-400 transition-colors"
                >
                  Go to Repositories
                </a>
              }
            />
          </div>
        )}

        {/* Empty: repos but no deps */}
        {nodes.length > 0 && edges.length === 0 && !loading && !scanning && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
            <div className="rounded-xl border border-zinc-700 bg-zinc-800/90 backdrop-blur px-5 py-3 text-center">
              <p className="text-sm text-zinc-300">
                No dependencies detected yet
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                Click "Scan Dependencies" to analyze repository relationships
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
