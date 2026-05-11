"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { SSEEvent } from "@/types/ft";

interface UseSSEReturn {
  events: SSEEvent[];
  status: "idle" | "connecting" | "open" | "closed" | "error";
  lastEvent: SSEEvent | null;
  clearEvents: () => void;
}

export function useSSE(url: string | null): UseSSEReturn {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [status, setStatus] = useState<UseSSEReturn["status"]>("idle");
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLastEvent(null);
  }, []);

  useEffect(() => {
    // Reset accumulated events whenever the URL changes (new run or run cleared)
    setEvents([]);
    setLastEvent(null);

    if (!url) {
      setStatus("idle");
      return;
    }

    setStatus("connecting");

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setStatus("open");
    };

    es.onmessage = (event) => {
      try {
        const data: SSEEvent = JSON.parse(event.data);
        setLastEvent(data);
        setEvents((prev) => [...prev, data]);

        // Close on terminal events
        if (data.type === "run:complete" || data.type === "run:error" || data.type === "run:not_found") {
          setStatus("closed");
          es.close();
        }
      } catch {
        // Skip unparseable messages
      }
    };

    es.onerror = () => {
      setStatus("error");
      es.close();
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [url]);

  return { events, status, lastEvent, clearEvents };
}
