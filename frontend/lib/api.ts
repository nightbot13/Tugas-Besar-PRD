/**
 * lib/api.ts
 * Typed fetch wrapper for the FastAPI parking backend.
 * All authenticated requests include Authorization: Bearer <token>.
 *
 * In development, use ANPR_SERVICE_TOKEN from backend .env as the token
 * (it has both anpr_service + dashboard_user accepted by require_dashboard_token).
 * In production, use create_dashboard_token(nim, settings) from backend.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WS_BASE  = process.env.NEXT_PUBLIC_WS_URL  ?? "ws://localhost:8000";

// ── Core types ────────────────────────────────────────────────────────────────

export type VehicleType = "motor" | "mobil";
export type VehicleStatus = "active" | "inactive" | "blocked";
export type GateAction = "open_gate" | "deny_access" | "cooldown" | "low_confidence";
export type GateEventType = "gate_entry" | "gate_exit";

export interface EWallet {
  provider: string;
  balance: number;
  masked_account?: string;
}

export interface Vehicle {
  plate_normalized: string;   // "D4321ITB"
  plate_raw: string;          // "D 4321 ITB"
  nim: string;
  owner: string;
  vehicle_type: VehicleType;
  model: string;
  status: VehicleStatus;
  anpr_verified: boolean;
  ewallet: EWallet | null;
  ewallet_backup: EWallet | null;
  is_parked: boolean;
  active_session: ActiveSession | null;
}

export interface ActiveSession {
  plate_normalized: string;
  plate_raw: string;
  model: string;
  vehicle_type: VehicleType;
  gate_id: string;
  entry_time: string;       // ISO 8601
  entry_ts: number;         // Unix timestamp
  elapsed_secs: number;
  duration_label: string;   // "6j 31m"
  est_fee: number;          // IDR integer
  est_fee_label: string;    // "Rp2.000"
  ewallet: EWallet | null;
}

export interface SessionStats {
  total_vehicles: number;
  active_sessions: ActiveSession[];
  active_count: number;
  today_completed: number;
}

export interface GateEvent {
  type: GateEventType;
  plate: string;
  plate_raw: string;
  gate_id: string;
  owner: string;
  vehicle_model: string;
  confidence: number;
  timestamp: string;
  duration_secs?: number;
  fee?: number;
}

export interface SystemStatus {
  api: string;
  dashboard_clients: number;
  online_gates: string[];
}

export interface AddVehiclePayload {
  plate_number: string;
  vehicle_type: VehicleType;
  model: string;
  nim?: string;
}

export interface ApiError {
  detail: string;
}

// ── Internal fetch helper ─────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string> ?? {}) },
  });

  if (!res.ok) {
    const body: ApiError = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Vehicle API ───────────────────────────────────────────────────────────────

export const vehicleApi = {
  /** List all vehicles for a NIM */
  list: (token: string, nim = "2021184750"): Promise<Vehicle[]> =>
    apiFetch<Vehicle[]>(`/api/v1/vehicles/?nim=${nim}`, {}, token),

  /** Register a new vehicle */
  add: (token: string, payload: AddVehiclePayload): Promise<{ message: string; plate_raw: string }> =>
    apiFetch(`/api/v1/vehicles/`, { method: "POST", body: JSON.stringify(payload) }, token),

  /** Delete a vehicle by normalized plate */
  delete: (token: string, plate: string): Promise<{ message: string }> =>
    apiFetch(`/api/v1/vehicles/${encodeURIComponent(plate)}`, { method: "DELETE" }, token),

  /** Get active sessions + dashboard stats */
  sessions: (token: string, nim = "2021184750"): Promise<SessionStats> =>
    apiFetch<SessionStats>(`/api/v1/vehicles/sessions?nim=${nim}`, {}, token),
};

// ── Gate API ──────────────────────────────────────────────────────────────────

export const gateApi = {
  getStatus: (): Promise<SystemStatus> =>
    apiFetch<SystemStatus>("/api/v1/gate/status"),

  getHistory: (token: string, limit = 50): Promise<unknown[]> =>
    apiFetch(`/api/v1/gate/history?limit=${limit}`, {}, token),
};

// ── WebSocket URL builder ─────────────────────────────────────────────────────

export function buildGateEventsWsUrl(token: string): string {
  return `${WS_BASE}/ws/gate-events?token=${encodeURIComponent(token)}`;
}

// ── Indonesian plate validator (client-side mirror of backend regex) ───────────

const PLATE_RE = /^[A-Z]{1,2}\s?\d{1,4}\s?[A-Z]{1,3}$/;

export interface PlateValidation {
  valid: boolean;
  error?: string;
  normalized?: string;   // "D4321ITB"
  formatted?: string;    // "D 4321 ITB"
}

export function validatePlate(raw: string): PlateValidation {
  const cleaned = raw.trim().toUpperCase();

  if (!cleaned) {
    return { valid: false, error: "Plat nomor tidak boleh kosong." };
  }
  if (cleaned.length < 4) {
    return { valid: false, error: "Plat nomor terlalu pendek." };
  }
  if (!PLATE_RE.test(cleaned)) {
    return {
      valid: false,
      error: "Format tidak valid. Contoh: B 1234 ABC, D 4321 ITB, AB 12 CD",
    };
  }

  const normalized = cleaned.replace(/\s/g, "");
  const match = normalized.match(/^([A-Z]{1,2})(\d{1,4})([A-Z]{1,3})$/);
  const formatted = match ? `${match[1]} ${match[2]} ${match[3]}` : normalized;

  return { valid: true, normalized, formatted };
}
