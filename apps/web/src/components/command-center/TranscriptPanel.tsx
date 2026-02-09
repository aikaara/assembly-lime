import { useEffect, useRef } from "react";
import type { AgentEvent } from "../../types";
import type { ConnectionState } from "./types";
import { EventCard } from "./EventCard";
import { Badge } from "../ui/Badge";
import { ScrollText } from "lucide-react";
import { EmptyState } from "../ui/EmptyState";

export function TranscriptPanel({
  events,
  connectionState,
}: {
  events: AgentEvent[];
  connectionState: ConnectionState;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Connection status */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
        <span
          className={`h-2 w-2 rounded-full ${
            connectionState === "connected"
              ? "bg-emerald-500"
              : connectionState === "connecting"
                ? "bg-amber-500 animate-pulse"
                : "bg-zinc-600"
          }`}
        />
        <span className="text-xs text-zinc-500">
          {connectionState === "connected"
            ? "Connected"
            : connectionState === "connecting"
              ? "Connecting..."
              : "Disconnected"}
        </span>
        {events.length > 0 && (
          <Badge variant="neutral">{events.length} events</Badge>
        )}
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
        {events.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No events yet"
            description="Submit a prompt to start an agent run. Events will stream here in real time."
          />
        ) : (
          events.map((event, i) => <EventCard key={i} event={event} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
