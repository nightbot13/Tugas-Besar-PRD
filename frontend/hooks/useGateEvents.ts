/**
 * hooks/useGateEvents.ts
 * WebSocket hook with optional onEvent callback for parent refresh.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildGateEventsWsUrl, type GateEvent } from "@/lib/api";

const MAX_EVENTS    = 50;
const INITIAL_DELAY = 1_000;
const MAX_DELAY     = 30_000;

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

interface UseGateEventsReturn {
  events: GateEvent[];
  connectionState: ConnectionState;
  latestEvent: GateEvent | null;
}

export function useGateEvents(
  token: string | null,
  onEvent?: (event: GateEvent) => void,
): UseGateEventsReturn {
  const [events, setEvents]             = useState<GateEvent[]>([]);
  const [connectionState, setConnState] = useState<ConnectionState>("disconnected");

  const wsRef        = useRef<WebSocket | null>(null);
  const retryDelay   = useRef(INITIAL_DELAY);
  const retryTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef   = useRef(true);
  const onEventRef   = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (!token || !mountedRef.current) return;
    setConnState("connecting");

    const url = buildGateEventsWsUrl(token);
    const ws  = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setConnState("connected");
      retryDelay.current = INITIAL_DELAY;
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(event.data as string) as GateEvent;
        setEvents((prev) => [data, ...prev].slice(0, MAX_EVENTS));
        onEventRef.current?.(data);
      } catch { /* ignore malformed */ }
    };

    ws.onerror = () => {
      if (mountedRef.current) setConnState("error");
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnState("disconnected");
      retryTimer.current = setTimeout(() => {
        retryDelay.current = Math.min(retryDelay.current * 2, MAX_DELAY);
        connect();
      }, retryDelay.current);
    };
  }, [token]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Keepalive ping every 20s
  useEffect(() => {
    const id = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send("ping");
      }
    }, 20_000);
    return () => clearInterval(id);
  }, []);

  return { events, connectionState, latestEvent: events[0] ?? null };
}
