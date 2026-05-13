/**
 * app/admin/page.tsx
 * Admin-only parking management dashboard.
 *
 * Access: POST /api/v1/admin/auth/token with username+password
 * Once logged in, admin can:
 *   - View ALL registered vehicles (any NIM)
 *   - Verify / revoke ANPR for any vehicle
 *   - See real-time parking status
 *
 * This page is completely separate from the student dashboard.
 * No link to it from the student-facing UI.
 * URL: /admin  (you can add HTTP Basic Auth or IP restriction at nginx level)
 */
"use client";

import { useState, useCallback, useEffect } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Types ────────────────────────────────────────────────────────────────────
interface AdminVehicle {
  plate_normalized: string;
  plate_raw:        string;
  nim:              string;
  owner:            string;
  vehicle_type:     string;
  model:            string;
  status:           string;
  anpr_verified:    boolean;
  is_parked:        boolean;
  ewallets:         { provider: string; balance: number; is_primary: boolean }[];
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiFetch(path: string, token: string, method = "GET", body?: object) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail ?? `HTTP ${res.status}`);
  return data;
}

// ═════════════════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═════════════════════════════════════════════════════════════════════════════
function LoginScreen({ onLogin }: { onLogin: (token: string, adminId: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const handleLogin = async () => {
    if (!username || !password) {
      setError("Username dan password wajib diisi.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/v1/admin/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "Login gagal.");
      onLogin(data.access_token, data.admin_id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Login gagal.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Roboto', sans-serif",
      }}
    >
      <div
        style={{
          background: "#fff",
          border: "1px solid #ddd",
          borderRadius: 4,
          padding: "32px 36px",
          width: 380,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              width: 48,
              height: 48,
              background: "#222",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 12px",
            }}
          >
            <i className="fa fa-shield" style={{ color: "#fff", fontSize: 20 }} />
          </div>
          <h2
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "#222",
              margin: 0,
            }}
          >
            Admin Parkir
          </h2>
          <p style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
            ITB Jatinangor — Panel Administrasi
          </p>
        </div>

        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="fg">
            <label>Username</label>
            <input
              type="text"
              placeholder="admin"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              style={{ width: "100%" }}
              autoFocus
              autoComplete="username"
            />
          </div>
          <div className="fg">
            <label>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              style={{ width: "100%" }}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div
              className="alert alert-warn"
              style={{ margin: 0, padding: "8px 12px", fontSize: 12 }}
            >
              {error}
            </div>
          )}

          <button
            type="button"
            className="btn btn-blue"
            onClick={handleLogin}
            disabled={loading}
            style={{
              width: "100%",
              justifyContent: "center",
              padding: "9px 0",
              fontSize: 14,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Masuk..." : "Masuk sebagai Admin"}
          </button>
        </div>

        <p
          style={{
            fontSize: 11,
            color: "#bbb",
            textAlign: "center",
            marginTop: 20,
          }}
        >
          Halaman ini hanya untuk petugas parkir yang berwenang.
        </p>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// VEHICLE ROW (inside admin table)
// ═════════════════════════════════════════════════════════════════════════════
function AdminVehicleRow({
  vehicle,
  token,
  onUpdated,
}: {
  vehicle:   AdminVehicle;
  token:     string;
  onUpdated: () => void;
}) {
  const [busy, setBusy]   = useState(false);
  const [msg,  setMsg]    = useState<{ ok: boolean; text: string } | null>(null);
  const [notes, setNotes] = useState("");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      onUpdated();
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Error." });
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = () =>
    run(() =>
      apiFetch(
        `/api/v1/admin/vehicles/${vehicle.plate_normalized}/verify-anpr`,
        token,
        "POST",
        { verified_by: "Admin Parkir", notes },
      ).then((d) => setMsg({ ok: true, text: d.message }))
    );

  const handleUnverify = () => {
    if (!confirm(`Cabut verifikasi ANPR untuk ${vehicle.plate_raw}?`)) return;
    run(() =>
      apiFetch(
        `/api/v1/admin/vehicles/${vehicle.plate_normalized}/unverify-anpr`,
        token,
        "POST",
      ).then((d) => setMsg({ ok: true, text: d.message }))
    );
  };

  const statusColor = vehicle.status === "active" ? "#27ae60"
                    : vehicle.status === "inactive" ? "#e67e22"
                    : "#e74c3c";

  return (
    <tr>
      {/* Plate */}
      <td>
        <span className="plate" style={{ fontSize: 10, padding: "2px 9px", letterSpacing: "2px" }}>
          {vehicle.plate_raw}
        </span>
      </td>

      {/* Owner / NIM */}
      <td>
        <div style={{ fontWeight: 500, fontSize: 13 }}>{vehicle.owner}</div>
        <div style={{ fontSize: 11, color: "#888" }}>{vehicle.nim}</div>
      </td>

      {/* Vehicle */}
      <td>
        <div style={{ fontSize: 13 }}>{vehicle.model}</div>
        <div style={{ fontSize: 11, color: "#888", textTransform: "capitalize" }}>
          {vehicle.vehicle_type}
        </div>
      </td>

      {/* Status */}
      <td>
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 600,
            background: vehicle.status === "active" ? "#dff0d8"
                      : vehicle.status === "inactive" ? "#fcf8e3"
                      : "#f2dede",
            color: statusColor,
          }}
        >
          {vehicle.status === "active" ? "Aktif"
           : vehicle.status === "inactive" ? "Belum Aktif"
           : "Diblokir"}
        </span>
        {vehicle.is_parked && (
          <span
            className="badge badge-blue"
            style={{ marginLeft: 6, fontSize: 10 }}
          >
            Parkir
          </span>
        )}
      </td>

      {/* E-Wallet */}
      <td style={{ fontSize: 12, color: "#555" }}>
        {vehicle.ewallets.length === 0 ? (
          <span style={{ color: "#c0392b" }}>Tidak ada</span>
        ) : (
          vehicle.ewallets.map((e) => (
            <div key={e.provider}>
              {e.provider}
              {e.is_primary && (
                <span style={{ color: "#888", fontSize: 10 }}> (primer)</span>
              )}
              <span style={{ color: "#31708f", marginLeft: 4 }}>
                Rp{e.balance.toLocaleString("id-ID")}
              </span>
            </div>
          ))
        )}
      </td>

      {/* ANPR Status + Actions */}
      <td>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Current ANPR status */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 600,
                background: vehicle.anpr_verified ? "#dff0d8" : "#f5f5f5",
                color: vehicle.anpr_verified ? "#27ae60" : "#888",
              }}
            >
              <i
                className={`fa ${vehicle.anpr_verified ? "fa-check-circle" : "fa-times-circle"}`}
                style={{ fontSize: 11 }}
              />
              {vehicle.anpr_verified ? "Terverifikasi" : "Belum Diverifikasi"}
            </span>
          </div>

          {/* Notes input (only when not yet verified) */}
          {!vehicle.anpr_verified && (
            <input
              type="text"
              placeholder="Catatan (opsional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                width: "100%",
                fontSize: 11,
                padding: "3px 7px",
                border: "1px solid #ccc",
                borderRadius: 3,
                fontFamily: "'Roboto', sans-serif",
              }}
            />
          )}

          {/* Action button */}
          <div style={{ display: "flex", gap: 6 }}>
            {!vehicle.anpr_verified ? (
              <button
                type="button"
                onClick={handleVerify}
                disabled={busy}
                style={{
                  background: "#337ab7",
                  color: "#fff",
                  border: "none",
                  borderRadius: 3,
                  padding: "4px 10px",
                  fontSize: 11,
                  cursor: busy ? "not-allowed" : "pointer",
                  fontFamily: "'Roboto', sans-serif",
                  opacity: busy ? 0.7 : 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <i className="fa fa-check" style={{ fontSize: 10 }} />
                {busy ? "Memproses..." : "Verifikasi ANPR"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleUnverify}
                disabled={busy}
                style={{
                  background: "#fff",
                  color: "#c0392b",
                  border: "1px solid #c0392b",
                  borderRadius: 3,
                  padding: "4px 10px",
                  fontSize: 11,
                  cursor: busy ? "not-allowed" : "pointer",
                  fontFamily: "'Roboto', sans-serif",
                  opacity: busy ? 0.7 : 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <i className="fa fa-times" style={{ fontSize: 10 }} />
                Cabut Verifikasi
              </button>
            )}
          </div>

          {/* Inline feedback */}
          {msg && (
            <div
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 3,
                background: msg.ok ? "#dff0d8" : "#f2dede",
                color: msg.ok ? "#27ae60" : "#c0392b",
              }}
            >
              {msg.text}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════
function AdminDashboard({
  token,
  adminId,
  onLogout,
}: {
  token:    string;
  adminId:  string;
  onLogout: () => void;
}) {
  const [vehicles, setVehicles] = useState<AdminVehicle[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [search,   setSearch]   = useState("");
  const [filterAnpr, setFilterAnpr] = useState<"all" | "verified" | "unverified">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/api/v1/admin/vehicles", token);
      setVehicles(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Gagal memuat data.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const filtered = vehicles.filter((v) => {
    const matchSearch =
      search === "" ||
      v.plate_raw.toLowerCase().includes(search.toLowerCase()) ||
      v.owner.toLowerCase().includes(search.toLowerCase()) ||
      v.nim.includes(search) ||
      v.model.toLowerCase().includes(search.toLowerCase());
    const matchAnpr =
      filterAnpr === "all" ||
      (filterAnpr === "verified" && v.anpr_verified) ||
      (filterAnpr === "unverified" && !v.anpr_verified);
    return matchSearch && matchAnpr;
  });

  const totalVerified   = vehicles.filter((v) => v.anpr_verified).length;
  const totalUnverified = vehicles.filter((v) => !v.anpr_verified).length;
  const totalParked     = vehicles.filter((v) => v.is_parked).length;

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", fontFamily: "'Roboto', sans-serif" }}>

      {/* ── Admin Topbar ── */}
      <nav
        style={{
          background: "#222",
          borderBottom: "1px solid #080808",
          height: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          position: "sticky",
          top: 0,
          zIndex: 1030,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              color: "#9d9d9d",
              fontSize: 18,
              fontWeight: 400,
              letterSpacing: 0.5,
            }}
          >
            SIX
          </span>
          <i className="fa fa-home" style={{ color: "#9d9d9d", fontSize: 14 }} />
          <span
            style={{
              color: "#666",
              fontSize: 13,
              marginLeft: 8,
              borderLeft: "1px solid #444",
              paddingLeft: 12,
            }}
          >
            Panel Admin Parkir
          </span>
          {/* Admin badge */}
          <span
            style={{
              background: "#c0392b",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 7px",
              borderRadius: 10,
              letterSpacing: 0.5,
              marginLeft: 4,
            }}
          >
            ADMIN
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ color: "#9d9d9d", fontSize: 13 }}>
            <i className="fa fa-user-circle-o" style={{ marginRight: 6 }} />
            {adminId}
          </span>
          <button
            type="button"
            onClick={onLogout}
            style={{
              background: "transparent",
              border: "1px solid #555",
              color: "#9d9d9d",
              borderRadius: 3,
              padding: "4px 12px",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "'Roboto', sans-serif",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <i className="fa fa-sign-out" style={{ fontSize: 12 }} />
            Keluar
          </button>
        </div>
      </nav>

      {/* ── Content ── */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>

        {/* Page header */}
        <div style={{ marginBottom: 20 }}>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 300,
              color: "#036",
              margin: "0 0 4px",
            }}
          >
            Verifikasi ANPR Kendaraan
          </h1>
          <p style={{ fontSize: 13, color: "#888", margin: 0 }}>
            ITB Jatinangor — Manajemen Verifikasi Plat Nomor
          </p>
        </div>

        {/* ── Stat cards ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
            marginBottom: 20,
          }}
        >
          {[
            { label: "Total Kendaraan", value: vehicles.length, color: "#31708f", bg: "#d9edf7" },
            { label: "Terverifikasi ANPR", value: totalVerified, color: "#27ae60", bg: "#dff0d8" },
            { label: "Belum Diverifikasi", value: totalUnverified, color: "#e67e22", bg: "#fcf8e3" },
            { label: "Sedang Parkir", value: totalParked, color: "#337ab7", bg: "#d9edf7" },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                background: "#fff",
                border: `1px solid ${s.bg}`,
                borderRadius: 4,
                padding: "14px 16px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>
                {s.value}
              </div>
              <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* ── Filter & search bar ── */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #dde",
            borderRadius: 4,
            padding: "12px 16px",
            marginBottom: 0,
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            borderBottom: "none",
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
          }}
        >
          {/* Search */}
          <div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 200 }}>
            <i className="fa fa-search" style={{ color: "#aaa", fontSize: 13 }} />
            <input
              type="text"
              placeholder="Cari plat, nama, NIM, model..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                border: "none",
                outline: "none",
                fontSize: 13,
                width: "100%",
                fontFamily: "'Roboto', sans-serif",
                color: "#333",
              }}
            />
          </div>

          {/* ANPR filter */}
          <div style={{ display: "flex", gap: 6 }}>
            {(["all", "unverified", "verified"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilterAnpr(f)}
                style={{
                  padding: "4px 12px",
                  borderRadius: 3,
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "'Roboto', sans-serif",
                  border: "1px solid",
                  borderColor: filterAnpr === f ? "#337ab7" : "#ddd",
                  background: filterAnpr === f ? "#337ab7" : "#fff",
                  color: filterAnpr === f ? "#fff" : "#555",
                  fontWeight: filterAnpr === f ? 600 : 400,
                  transition: "all 0.15s",
                }}
              >
                {f === "all" ? "Semua"
                 : f === "verified" ? "✓ Terverifikasi"
                 : "✗ Belum Diverifikasi"}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            style={{
              background: "#fff",
              border: "1px solid #ddd",
              borderRadius: 3,
              padding: "4px 12px",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "'Roboto', sans-serif",
              color: "#555",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <i className={`fa fa-refresh ${loading ? "fa-spin" : ""}`} style={{ fontSize: 12 }} />
            Refresh
          </button>
        </div>

        {/* ── Vehicle table ── */}
        <div
          className="panel"
          style={{ marginBottom: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
        >
          <div className="panel-head">
            Daftar Kendaraan
            <span
              className="badge badge-blue"
              style={{ marginLeft: 10, fontWeight: 400, fontSize: 11 }}
            >
              {filtered.length} kendaraan
            </span>
          </div>
          <div className="panel-body" style={{ padding: 0 }}>
            {loading ? (
              <div style={{ padding: "28px 0", textAlign: "center", color: "#888", fontSize: 13 }}>
                <i className="fa fa-spinner fa-spin" style={{ marginRight: 8 }} />
                Memuat data...
              </div>
            ) : error ? (
              <div className="alert alert-warn" style={{ margin: 16 }}>
                {error}
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: "28px 0", textAlign: "center", color: "#aaa", fontSize: 13 }}>
                Tidak ada kendaraan yang sesuai filter.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>Plat Nomor</th>
                    <th style={{ width: 160 }}>Pemilik / NIM</th>
                    <th style={{ width: 150 }}>Kendaraan</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ width: 160 }}>E-Wallet</th>
                    <th>Status ANPR &amp; Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v) => (
                    <AdminVehicleRow
                      key={v.plate_normalized}
                      vehicle={v}
                      token={token}
                      onUpdated={load}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Info box ── */}
        <div className="alert alert-info" style={{ marginTop: 16 }}>
          <strong>Cara kerja verifikasi ANPR:</strong> Setelah mahasiswa mendaftarkan kendaraan,
          petugas parkir harus memverifikasi plat nomor secara langsung dengan mencocokkan STNK
          fisik. Setelah diverifikasi, sistem ANPR akan secara otomatis mengenali kendaraan
          tersebut dan membuka gerbang. Kendaraan yang belum diverifikasi tidak dapat menggunakan
          gerbang otomatis.
        </div>

        <p style={{ fontSize: 11, color: "#bbb", textAlign: "center", marginTop: 12 }}>
          Panel Admin — ITB Jatinangor Parking System &bull; Login sebagai: {adminId}
        </p>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ROOT PAGE COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function AdminPage() {
  const [token,   setToken]   = useState<string | null>(null);
  const [adminId, setAdminId] = useState<string>("");

  const handleLogin = (t: string, id: string) => {
    setToken(t);
    setAdminId(id);
    // Store in sessionStorage so page refresh keeps admin logged in
    sessionStorage.setItem("admin_token",  t);
    sessionStorage.setItem("admin_id",     id);
  };

  const handleLogout = () => {
    setToken(null);
    setAdminId("");
    sessionStorage.removeItem("admin_token");
    sessionStorage.removeItem("admin_id");
  };

  // Restore session on mount
  if (typeof window !== "undefined" && !token) {
    const stored = sessionStorage.getItem("admin_token");
    const storedId = sessionStorage.getItem("admin_id");
    if (stored && storedId) {
      // Defer to avoid setState during render
    }
  }

  // Restore from sessionStorage using useEffect pattern
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!restored) {
      const t  = sessionStorage.getItem("admin_token");
      const id = sessionStorage.getItem("admin_id");
      if (t && id) {
        setToken(t);
        setAdminId(id);
      }
      setRestored(true);
    }
  }, [restored]);

  if (!restored) return null; // Prevent flash

  if (!token) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <AdminDashboard
      token={token}
      adminId={adminId}
      onLogout={handleLogout}
    />
  );
}
