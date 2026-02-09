import { useReducer, useMemo, useEffect } from "react";
import type { Ticket, ColumnKey } from "../types";
import { COLUMN_KEYS } from "../types";

type Action =
  | { type: "MOVE_TICKET"; ticketId: string; toColumn: ColumnKey; toIndex: number }
  | { type: "ADD_TICKET"; ticket: Ticket }
  | { type: "UPDATE_TICKET"; ticketId: string; updates: Partial<Ticket> }
  | { type: "SET_TICKETS"; tickets: Ticket[] };

type State = {
  tickets: Ticket[];
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "MOVE_TICKET":
      return {
        tickets: state.tickets.map((t) =>
          t.id === action.ticketId ? { ...t, column: action.toColumn } : t,
        ),
      };

    case "ADD_TICKET":
      return { tickets: [...state.tickets, action.ticket] };

    case "UPDATE_TICKET":
      return {
        tickets: state.tickets.map((t) =>
          t.id === action.ticketId ? { ...t, ...action.updates } : t,
        ),
      };

    case "SET_TICKETS":
      return { tickets: action.tickets };
  }
}

export function useKanbanState(initialTickets?: Ticket[]) {
  const [state, dispatch] = useReducer(reducer, {
    tickets: initialTickets ?? [],
  });

  useEffect(() => {
    if (initialTickets && initialTickets.length > 0) {
      dispatch({ type: "SET_TICKETS", tickets: initialTickets });
    }
  }, [initialTickets]);

  const ticketsByColumn = useMemo(() => {
    const grouped: Record<ColumnKey, Ticket[]> = {} as Record<ColumnKey, Ticket[]>;
    for (const key of COLUMN_KEYS) {
      grouped[key] = [];
    }
    for (const ticket of state.tickets) {
      if (grouped[ticket.column]) {
        grouped[ticket.column].push(ticket);
      }
    }
    return grouped;
  }, [state.tickets]);

  return {
    tickets: state.tickets,
    ticketsByColumn,
    dispatch,
  };
}
