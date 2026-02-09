import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import type { MeResponse, ProjectSummary } from "../types";

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | {
      status: "authenticated";
      user: MeResponse["user"];
      tenant: MeResponse["tenant"];
      roles: string[];
      projects: ProjectSummary[];
      currentProjectId: string | null;
    };

type AuthContextValue = AuthState & {
  logout: () => Promise<void>;
  setCurrentProjectId: (id: string) => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);

  const fetchMe = useCallback(async () => {
    try {
      const me = await api.get<MeResponse>("/me");
      const projId = currentProjectId ?? me.projects[0]?.id ?? null;
      setCurrentProjectId(projId);
      setState({
        status: "authenticated",
        user: me.user,
        tenant: me.tenant,
        roles: me.roles,
        projects: me.projects,
        currentProjectId: projId,
      });
    } catch {
      setState({ status: "unauthenticated" });
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore
    }
    setState({ status: "unauthenticated" });
  }, []);

  const handleSetProjectId = useCallback(
    (id: string) => {
      setCurrentProjectId(id);
      if (state.status === "authenticated") {
        setState({ ...state, currentProjectId: id });
      }
    },
    [state],
  );

  const value: AuthContextValue =
    state.status === "authenticated"
      ? {
          ...state,
          currentProjectId,
          logout,
          setCurrentProjectId: handleSetProjectId,
          refresh: fetchMe,
        }
      : {
          ...state,
          logout,
          setCurrentProjectId: handleSetProjectId,
          refresh: fetchMe,
        };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
