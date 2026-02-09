import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { CommandCenterPage } from "./pages/CommandCenterPage";
import { BoardPage } from "./pages/BoardPage";
import { AgentRunsPage } from "./pages/AgentRunsPage";
import { RunDetailPage } from "./pages/RunDetailPage";

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
      </Route>
    </Routes>
  );
}

export default App;
