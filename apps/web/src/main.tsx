import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { RecentRunsProvider } from "./hooks/useRecentRuns";
import App from "./App";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <RecentRunsProvider>
          <App />
        </RecentRunsProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
