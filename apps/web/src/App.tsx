import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { CommandCenterPage } from "./pages/CommandCenterPage";
import { BoardPage } from "./pages/BoardPage";
import { AgentRunsPage } from "./pages/AgentRunsPage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { ReposPage } from "./pages/ReposPage";
import { RepoDetailPage } from "./pages/RepoDetailPage";
import { ConnectorsPage } from "./pages/ConnectorsPage";
import { ClustersPage } from "./pages/ClustersPage";
import { SandboxesPage } from "./pages/SandboxesPage";
import { DomainsPage } from "./pages/DomainsPage";
import { RepoDependencyGraphPage } from "./pages/RepoDependencyGraphPage";

function App() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/command-center" replace />} />
        <Route path="command-center" element={<CommandCenterPage />} />
        <Route path="board" element={<BoardPage />} />
        <Route path="runs" element={<AgentRunsPage />} />
        <Route path="runs/:id" element={<RunDetailPage />} />
        <Route path="repos" element={<ReposPage />} />
        <Route path="repos/dependencies" element={<RepoDependencyGraphPage />} />
        <Route path="repos/:id" element={<RepoDetailPage />} />
        <Route path="connectors" element={<ConnectorsPage />} />
        <Route path="clusters" element={<ClustersPage />} />
        <Route path="sandboxes" element={<SandboxesPage />} />
        <Route path="domains" element={<DomainsPage />} />
      </Route>
    </Routes>
  );
}

export default App;
