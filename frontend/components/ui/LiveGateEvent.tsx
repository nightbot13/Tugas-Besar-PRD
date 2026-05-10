/**
 * components/ui/LiveGateEvent.tsx
 * Real-time gate event feed via WebSocket.
 * Uses globals.css classes: .gate-event-row, .gate-event-icon, .ws-status, etc.
 */
"use client";

import { useGateEvents } from "@/hooks/useGateEvents";
import type { GateEvent } from "@/lib/api";

interface LiveGateEventProps {
  token: string | null;
}

const WS_STATE_CONFIG = {
  connected:    { label: "Live",           dotClass: "connected"    },
  connecting:   { label: "Menghubungkan...", dotClass: "connecting"  },
  disconnected: { label: "Terputus",       dotClass: "disconnected" },
  error:        { label: "Error",          dotClass: "error"        },
} as const;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("id-ID", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function formatDuration(secs?: number): string {
  if (!secs) return "–";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}j ${m}m` : `${m}m`;
}

function EventRow({ event }: { event: GateEvent }) {
  const isEntry = event.type === "gate_entry";

  return (
    <div className="gate-event-row">
      <div className={`gate-event-icon ${isEntry ? "entry" : "exit"}`}>
        {isEntry ? "▼" : "▲"}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <span className="plate" style={{ fontSize: 9, padding: "2px 7px", letterSpacing: "1.5px" }}>
            {event.plate_raw}
          </span>
          <span className={`badge ${isEntry ? "badge-blue" : "badge-green"}`}>
            {isEntry ? "Masuk" : "Keluar"}
          </span>
          <span style={{ fontSize: 10.5, color: "#888" }}>
            ANPR {(event.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <div style={{ fontSize: 12, color: "#666", marginTop: 3 }}>
          {event.owner} &bull; {event.vehicle_model} &bull; {event.gate_id}
          {!isEntry && event.fee !== undefined && (
            <>
              {" "}&bull; Biaya:{" "}
              <strong style={{ color: "#3c763d" }}>
                Rp{event.fee.toLocaleString("id-ID")}
              </strong>
              {event.duration_secs !== undefined && ` (${formatDuration(event.duration_secs)})`}
            </>
          )}
        </div>
      </div>

      <div className="gate-event-time">{formatTime(event.timestamp)}</div>
    </div>
  );
}

export function LiveGateEvent({ token }: LiveGateEventProps) {
  const { events, connectionState } = useGateEvents(token);
  const cfg = WS_STATE_CONFIG[connectionState];

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Feed Real-Time Gerbang</span>
        <span className="ws-status">
          <span className={`ws-dot ${cfg.dotClass}`} />
          {cfg.label}
        </span>
      </div>

      <div className="panel-body" style={{ padding: "0 14px", maxHeight: 300, overflowY: "auto" }}>
        {events.length === 0 ? (
          <div style={{ padding: "20px 0", textAlign: "center", color: "#aaa", fontSize: 13 }}>
            {connectionState === "connected"
              ? "Menunggu aktivitas gerbang..."
              : "Tidak terhubung ke server real-time."}
          </div>
        ) : (
          events.map((ev, i) => <EventRow key={i} event={ev} />)
        )}
      </div>
    </div>
  );
}
