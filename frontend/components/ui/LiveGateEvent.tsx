/**
 * components/ui/LiveGateEvent.tsx
 * Real-time gate event feed via WebSocket.
 * Accepts optional onEvent callback so parent can refresh DB stats on new events.
 */
"use client";

import { useGateEvents } from "@/hooks/useGateEvents";
import type { GateEvent } from "@/lib/api";

interface LiveGateEventProps {
  token: string | null;
  onEvent?: (event: GateEvent) => void;
}

const WS_STATE_CONFIG = {
  connected:    { label: "Live",              dotClass: "connected"    },
  connecting:   { label: "Menghubungkan...",  dotClass: "connecting"  },
  disconnected: { label: "Terputus",          dotClass: "disconnected" },
  error:        { label: "Error",             dotClass: "error"        },
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
              {event.duration_secs !== undefined &&
                ` (${formatDuration(event.duration_secs)})`}
            </>
          )}
        </div>
      </div>
      <div className="gate-event-time">{formatTime(event.timestamp)}</div>
    </div>
  );
}

export function LiveGateEvent({ token, onEvent }: LiveGateEventProps) {
  const { events, connectionState } = useGateEvents(token, onEvent);
  const cfg = WS_STATE_CONFIG[connectionState];

  // When token is null, WS won't connect — show clear explanation
  if (!token) {
    return (
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">Feed Real-Time Gerbang</div>
        <div className="panel-body">
          <div className="alert alert-info" style={{ margin: 0, fontSize: 12 }}>
            <strong>Feed Real-Time Gerbang</strong> menampilkan setiap kendaraan yang
            masuk/keluar secara langsung saat ANPR mendeteksi plat nomor.
            Untuk mengaktifkan, set <code>NEXT_PUBLIC_DASHBOARD_TOKEN</code> di{" "}
            <code>frontend/.env.local</code>.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <div
        className="panel-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <span>Feed Real-Time Gerbang</span>
        <span className="ws-status">
          <span className={`ws-dot ${cfg.dotClass}`} />
          {cfg.label}
        </span>
      </div>
      <div className="panel-body" style={{ padding: "0 14px", maxHeight: 280, overflowY: "auto" }}>
        {events.length === 0 ? (
          <div style={{ padding: "18px 0" }}>
            <div style={{ textAlign: "center", color: "#aaa", fontSize: 13, marginBottom: 10 }}>
              {connectionState === "connected"
                ? "Menunggu aktivitas gerbang..."
                : "Menghubungkan ke server..."}
            </div>
            {connectionState === "connected" && (
              <div style={{ fontSize: 11, color: "#bbb", textAlign: "center", lineHeight: 1.6 }}>
                Feed ini akan menampilkan aktivitas secara otomatis saat ANPR
                mendeteksi plat nomor dan script <code>anpr_main.py</code> berjalan.
              </div>
            )}
          </div>
        ) : (
          events.map((ev, i) => <EventRow key={i} event={ev} />)
        )}
      </div>
    </div>
  );
}
