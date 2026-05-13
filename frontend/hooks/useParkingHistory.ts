/**
 * hooks/useParkingHistory.ts
 * SWR hook that fetches parking session history from the FastAPI backend.
 * Polls every 60 seconds so the Riwayat tab stays fresh without WebSocket overhead.
 *
 * In development (no token), falls back to the mock data passed as fallback.
 */
"use client";

import useSWR from "swr";
import type { ParkingSession } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000; // 1 minute

async function historyFetcher([url, token]: [string, string]): Promise<ParkingSession[]> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ParkingSession[]>;
}

interface UseParkingHistoryOptions {
  token:    string | null;
  limit?:   number;
  apiBase?: string;
  fallback?: ParkingSession[];
}

interface UseParkingHistoryReturn {
  sessions:    ParkingSession[];
  isLoading:   boolean;
  isError:     boolean;
  refresh:     () => void;
}

export function useParkingHistory({
  token,
  limit   = 50,
  apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  fallback = [],
}: UseParkingHistoryOptions): UseParkingHistoryReturn {
  const url = `${apiBase}/api/v1/gate/history?limit=${limit}`;

  const { data, error, isLoading, mutate } = useSWR<ParkingSession[]>(
    // Only fetch when we have a token
    token ? [url, token] : null,
    historyFetcher,
    {
      refreshInterval:    POLL_INTERVAL_MS,
      revalidateOnFocus:  false,
      fallbackData:       fallback,
    },
  );

  return {
    sessions:  data ?? fallback,
    isLoading,
    isError:   !!error,
    refresh:   () => mutate(),
  };
}
