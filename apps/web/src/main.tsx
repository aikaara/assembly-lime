import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { RecentRunsProvider } from "./hooks/useRecentRuns";
import { ToastProvider } from "./components/ui/Toast";
import App from "./App";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <RecentRunsProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </RecentRunsProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
