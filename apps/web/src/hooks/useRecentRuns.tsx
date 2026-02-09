import { createContext, useContext, useCallback, useState } from "react";

type RecentRunsContextValue = {
  recentRunIds: string[];
  addRunId: (id: string) => void;
};

const RecentRunsContext = createContext<RecentRunsContextValue | null>(null);

export function RecentRunsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [recentRunIds, setRecentRunIds] = useState<string[]>([]);

  const addRunId = useCallback((id: string) => {
    setRecentRunIds((prev) => {
      if (prev.includes(id)) return prev;
      return [id, ...prev].slice(0, 50);
    });
  }, []);

  return (
    <RecentRunsContext.Provider value={{ recentRunIds, addRunId }}>
      {children}
    </RecentRunsContext.Provider>
  );
}

export function useRecentRuns() {
  const ctx = useContext(RecentRunsContext);
  if (!ctx) {
    throw new Error("useRecentRuns must be used within RecentRunsProvider");
  }
  return ctx;
}
