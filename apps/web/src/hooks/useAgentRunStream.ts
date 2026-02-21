import { useEffect, useReducer, useRef, useState } from "react";
import type { AgentEvent, AgentRunStatus } from "../types";

type ConnectionState = "disconnected" | "connecting" | "connected";

type State = {
  events: AgentEvent[];
  connectionState: ConnectionState;
  runStatus: AgentRunStatus | null;
};

type Action =
  | { type: "EVENT"; event: AgentEvent }
  | { type: "CONNECTION_STATE"; state: ConnectionState }
  | { type: "RESET" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "EVENT": {
      const newState = { ...state, events: [...state.events, action.event] };
      // Track run status from status events
      if (action.event.type === "status") {
        newState.runStatus = action.event.status;
      }
      return newState;
    }
    case "CONNECTION_STATE":
      return { ...state, connectionState: action.state };
    case "RESET":
      return { events: [], connectionState: "disconnected", runStatus: null };
  }
}

const TERMINAL_STATUSES: AgentRunStatus[] = ["completed", "failed", "cancelled"];

export function useAgentRunStream(runId: string | null) {
  const [state, dispatch] = useReducer(reducer, {
    events: [],
    connectionState: "disconnected",
    runStatus: null,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const [shouldConnect, setShouldConnect] = useState(false);

  // Reset state when runId changes
  useEffect(() => {
    dispatch({ type: "RESET" });
    retryCountRef.current = 0;
    if (runId) {
      setShouldConnect(true);
    } else {
      setShouldConnect(false);
    }
  }, [runId]);

  useEffect(() => {
    if (!runId || !shouldConnect) return;

    function connect() {
      if (!runId) return;

      dispatch({ type: "CONNECTION_STATE", state: "connecting" });

      const apiBase = import.meta.env.VITE_API_WS_URL as string | undefined;
      const wsUrl = apiBase
        ? `${apiBase}/ws/agent-runs/${runId}`
        : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/agent-runs/${runId}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        dispatch({ type: "CONNECTION_STATE", state: "connected" });
        retryCountRef.current = 0;
      });

      ws.addEventListener("message", (e) => {
        try {
          const event = JSON.parse(e.data) as AgentEvent;
          dispatch({ type: "EVENT", event });

          // Stop reconnecting only on truly terminal statuses
          if (
            event.type === "status" &&
            TERMINAL_STATUSES.includes(event.status)
          ) {
            setShouldConnect(false);
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.addEventListener("close", () => {
        dispatch({ type: "CONNECTION_STATE", state: "disconnected" });
        wsRef.current = null;

        // Reconnect with exponential backoff
        if (shouldConnect) {
          const delay = Math.min(1000 * 2 ** retryCountRef.current, 10000);
          retryCountRef.current++;
          setTimeout(connect, delay);
        }
      });

      ws.addEventListener("error", () => {
        ws.close();
      });
    }

    connect();

    return () => {
      setShouldConnect(false);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [runId, shouldConnect]);

  return {
    events: state.events,
    connectionState: state.connectionState,
    runStatus: state.runStatus,
  };
}
