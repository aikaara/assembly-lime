import { type ReactNode } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";
import {
  ToastContext,
  useToastState,
  type ToastType,
} from "../../hooks/useToast";

const ICONS: Record<ToastType, ReactNode> = {
  success: (
    <div className="h-5 w-5 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
      <CheckCircle2 className="h-3 w-3 text-green-400" />
    </div>
  ),
  error: (
    <div className="h-5 w-5 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
      <XCircle className="h-3 w-3 text-red-400" />
    </div>
  ),
  warning: (
    <div className="h-5 w-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
      <AlertTriangle className="h-3 w-3 text-amber-400" />
    </div>
  ),
  info: (
    <div className="h-5 w-5 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
      <Info className="h-3 w-3 text-blue-400" />
    </div>
  ),
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const state = useToastState();

  return (
    <ToastContext.Provider value={state}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {state.toasts.map((toast) => (
          <div
            key={toast.id}
            className="flex items-start gap-3 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 shadow-xl min-w-72 animate-slideUp"
          >
            {ICONS[toast.type]}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-200">
                {toast.title}
              </p>
              {toast.description && (
                <p className="text-xs text-zinc-500 mt-0.5">
                  {toast.description}
                </p>
              )}
            </div>
            <button
              onClick={() => state.removeToast(toast.id)}
              className="text-zinc-600 hover:text-zinc-400 shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
