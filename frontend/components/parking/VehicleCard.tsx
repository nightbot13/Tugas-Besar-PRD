/**
 * components/parking/VehicleCard.tsx
 * Vehicle row with full e-wallet management + real logo icons.
 *
 * Bugs fixed:
 *  1. Status badge: shows "Belum Aktif" when anpr_verified=false regardless of status field
 *  2. addProvider stale state: derived from availableToAdd[0] dynamically, never stale
 *  3. E-wallet logo: uses real uploaded PNG images from /img/ewallet/
 *  4. onUpdated: safely guarded with typeof check
 */
"use client";

import Image from "next/image";
import { useState, useMemo } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── E-wallet metadata with real logo paths ────────────────────────────────────
const EWALLET_OPTIONS = [
  { name: "GoPay",     logo: "/img/ewallet/gopay.png",     fallbackColor: "#00aae4" },
  { name: "OVO",       logo: "/img/ewallet/ovo.png",       fallbackColor: "#4c3494" },
  { name: "ShopeePay", logo: "/img/ewallet/shopeepay.png", fallbackColor: "#f05024" },
  { name: "Dana",      logo: "/img/ewallet/dana.png",      fallbackColor: "#108ee9" },
  { name: "LinkAja",   logo: "/img/ewallet/linkaja.png",   fallbackColor: "#e82529" },
];

function ewalletMeta(name: string) {
  return EWALLET_OPTIONS.find((e) => e.name === name)
    ?? { name, logo: null, fallbackColor: "#888" };
}

// ── E-wallet logo component ───────────────────────────────────────────────────
function EwalletLogo({ name, size = 32 }: { name: string; size?: number }) {
  const meta = ewalletMeta(name);
  const [imgError, setImgError] = useState(false);

  if (meta.logo && !imgError) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          overflow: "hidden",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5f5f5",
        }}
      >
        <Image
          src={meta.logo}
          alt={name}
          width={size}
          height={size}
          style={{ objectFit: "cover", borderRadius: "50%" }}
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  // Fallback: colored circle with initial
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: meta.fallbackColor,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.4),
        color: "#fff",
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {name[0]}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Ewallet {
  provider:       string;
  balance:        number;
  masked_account: string;
  is_primary:     boolean;
}

export interface VehicleData {
  plate_normalized: string;
  plate_raw:        string;
  nim:              string;
  owner:            string;
  vehicle_type:     string;
  model:            string;
  status:           string;
  anpr_verified:    boolean;
  ewallets:         Ewallet[];
  is_parked:        boolean;
}

interface VehicleCardProps {
  vehicle:    VehicleData;
  token:      string | null;
  onUpdated?: () => void | Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
export function VehicleCard({ vehicle, token, onUpdated }: VehicleCardProps) {
  const [showEwallet,      setShowEwallet]      = useState(false);
  const [busy,             setBusy]             = useState(false);
  const [msg,              setMsg]              = useState<{ ok: boolean; text: string } | null>(null);
  const [addAccount,       setAddAccount]       = useState("");
  const [addBalance,       setAddBalance]       = useState("100000");
  const [addPrimary,       setAddPrimary]       = useState(false);
  const [editBalanceProv,  setEditBalanceProv]  = useState<string | null>(null);
  const [editBalanceVal,   setEditBalanceVal]   = useState("");

  // ── Bug 2 fix: derive availableToAdd first, then derive addProvider from it ──
  // Never use a static initial value — always reflect what's actually available.
  const availableToAdd = useMemo(
    () => EWALLET_OPTIONS.filter(
      (opt) => !vehicle.ewallets.some((e) => e.provider === opt.name)
    ),
    [vehicle.ewallets]
  );

  // addProvider is always the first available option — updated whenever availableToAdd changes
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  // Compute the actual provider to use: prefer selectedProvider if still available, else first
  const addProvider = useMemo(() => {
    const stillAvailable = availableToAdd.find((o) => o.name === selectedProvider);
    return stillAvailable?.name ?? availableToAdd[0]?.name ?? "";
  }, [availableToAdd, selectedProvider]);

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const plate = vehicle.plate_normalized;

  // ── Bug 1 fix: status display logic ──────────────────────────────────────────
  // A vehicle should only show "Aktif" if BOTH: status=active AND anpr_verified=true
  // If anpr_verified=false, always show "Belum Aktif" regardless of backend status field
  const displayActive   = vehicle.status === "active" && vehicle.anpr_verified;
  const displayInactive = !displayActive && vehicle.status !== "blocked";
  const displayBlocked  = vehicle.status === "blocked";

  async function api(method: string, path: string, body?: object) {
    const res = await fetch(`${API}/api/v1/vehicles/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail ?? "Terjadi kesalahan.");
    return data;
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (typeof onUpdated === "function") {
        await Promise.resolve(onUpdated());
      }
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Error." });
    } finally {
      setBusy(false);
    }
  }

  const handleDelete = () => {
    if (!confirm(`Hapus kendaraan ${vehicle.plate_raw}?`)) return;
    run(() => api("DELETE", plate).then(() => {}));
  };

  const handleAddEwallet = () => {
    if (!addProvider) {
      setMsg({ ok: false, text: "Pilih provider e-wallet terlebih dahulu." });
      return;
    }
    run(() =>
      api("POST", `${plate}/ewallet`, {
        provider:        addProvider,
        masked_account:  addAccount || undefined,
        initial_balance: parseInt(addBalance) || 0,
        set_as_primary:  addPrimary,
      }).then(() => {
        setAddAccount("");
        setAddBalance("100000");
        setAddPrimary(false);
        setSelectedProvider(""); // reset selection
      })
    );
  };

  const handleRemoveEwallet = (provider: string) => {
    if (!confirm(`Hapus ${provider} dari kendaraan ini?`)) return;
    run(() => api("DELETE", `${plate}/ewallet/${provider}`).then(() => {}));
  };

  const handleSetPrimary = (provider: string) =>
    run(() => api("PUT", `${plate}/ewallet/${provider}/primary`).then(() => {}));

  const handleUpdateBalance = (provider: string) =>
    run(() =>
      api("PUT", `${plate}/ewallet/${provider}/balance`, {
        balance: parseInt(editBalanceVal) || 0,
      }).then(() => { setEditBalanceProv(null); setEditBalanceVal(""); })
    );

  return (
    <div style={{ borderBottom: "1px solid #f0f0f0" }}>

      {/* ── Main vehicle row ── */}
      <div className="vehicle-row" style={{ borderBottom: "none" }}>
        <div className="v-left">
          <span className="plate">{vehicle.plate_raw}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#333" }}>
              {vehicle.model}
              {vehicle.is_parked && (
                <span className="badge badge-blue" style={{ marginLeft: 8, fontSize: 10, verticalAlign: "middle" }}>
                  Sedang Parkir
                </span>
              )}
            </div>
            <div className="v-meta">
              {vehicle.vehicle_type === "motor" ? "Motor" : "Mobil"}
              {vehicle.ewallets.length > 0 ? (
                <> &bull; {vehicle.ewallets.map((e) => e.provider).join(", ")} terhubung</>
              ) : (
                <> &bull; <span style={{ color: "#c0392b" }}>Belum ada e-wallet</span></>
              )}
              {vehicle.anpr_verified ? (
                <> &bull; <span style={{ color: "#27ae60" }}>ANPR Terverifikasi ✓</span></>
              ) : (
                <> &bull; <span style={{ color: "#e67e22" }}>Belum Terverifikasi ANPR</span></>
              )}
            </div>
          </div>
        </div>

        <div className="v-actions">
          {/* Bug 1 fix: badge derived from displayActive/displayInactive/displayBlocked */}
          <span className={`badge ${displayActive ? "badge-green" : displayBlocked ? "badge-red" : "badge-orange"}`}>
            {displayActive ? "Aktif" : displayBlocked ? "Diblokir" : "Belum Aktif"}
          </span>

          <button
            type="button"
            className="btn btn-outline-blue"
            onClick={() => { setShowEwallet(!showEwallet); setMsg(null); }}
            disabled={busy}
          >
            {vehicle.ewallets.length > 0 ? "Kelola E-Wallet" : "Hubungkan E-Wallet"}
          </button>

          <button
            type="button"
            className="btn btn-outline-red"
            onClick={handleDelete}
            disabled={busy || vehicle.is_parked}
            style={{ opacity: vehicle.is_parked ? 0.5 : 1, cursor: vehicle.is_parked ? "not-allowed" : "pointer" }}
          >
            Hapus
          </button>
        </div>
      </div>

      {/* ── Inline message ── */}
      {msg && (
        <div
          className={`alert ${msg.ok ? "alert-success" : "alert-warn"}`}
          style={{ margin: "4px 0 8px", padding: "6px 12px", fontSize: 12 }}
        >
          {msg.text}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          E-WALLET MANAGEMENT PANEL
      ══════════════════════════════════════════════════════════════════ */}
      {showEwallet && (
        <div
          style={{
            background: "#f8fbff",
            border: "1px solid #c8dff5",
            borderRadius: 3,
            padding: "14px 16px",
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <strong style={{ fontSize: 13, color: "#1a4a80" }}>
              Kelola E-Wallet — {vehicle.plate_raw}
            </strong>
            <button type="button" className="btn-link" onClick={() => setShowEwallet(false)}>
              Tutup
            </button>
          </div>

          {/* ── Existing e-wallets ── */}
          {vehicle.ewallets.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
              {vehicle.ewallets.map((ew) => {
                const isEditingBalance = editBalanceProv === ew.provider;
                return (
                  <div
                    key={ew.provider}
                    style={{
                      background: "#fff",
                      border: `1px solid ${ew.is_primary ? "#337ab7" : "#dde"}`,
                      borderRadius: 4,
                      padding: "10px 14px",
                      minWidth: 200,
                      boxShadow: ew.is_primary ? "0 0 0 2px rgba(51,122,183,0.15)" : "none",
                    }}
                  >
                    {/* Provider header with real logo */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <EwalletLogo name={ew.provider} size={30} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "#333" }}>{ew.provider}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>{ew.masked_account}</div>
                      </div>
                      <span className={`badge ${ew.is_primary ? "badge-blue" : "badge-gray"}`}>
                        {ew.is_primary ? "Primer" : "Cadangan"}
                      </span>
                    </div>

                    {/* Balance row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      {isEditingBalance ? (
                        <>
                          <span style={{ fontSize: 11, color: "#555" }}>Rp</span>
                          <input
                            type="number"
                            value={editBalanceVal}
                            onChange={(e) => setEditBalanceVal(e.target.value)}
                            style={{ width: 90, fontSize: 12, padding: "2px 6px", border: "1px solid #ccc", borderRadius: 3 }}
                            min={0}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="btn btn-blue"
                            style={{ padding: "2px 8px", fontSize: 11 }}
                            onClick={() => handleUpdateBalance(ew.provider)}
                            disabled={busy}
                          >
                            Simpan
                          </button>
                          <button
                            type="button"
                            className="btn-link"
                            style={{ fontSize: 11 }}
                            onClick={() => { setEditBalanceProv(null); setEditBalanceVal(""); }}
                          >
                            Batal
                          </button>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#31708f" }}>
                            Rp{ew.balance.toLocaleString("id-ID")}
                          </span>
                          <button
                            type="button"
                            className="btn-link"
                            style={{ fontSize: 11 }}
                            onClick={() => { setEditBalanceProv(ew.provider); setEditBalanceVal(String(ew.balance)); }}
                          >
                            Edit Saldo
                          </button>
                        </>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {!ew.is_primary && (
                        <button
                          type="button"
                          className="btn btn-outline-blue"
                          style={{ padding: "3px 8px", fontSize: 11 }}
                          onClick={() => handleSetPrimary(ew.provider)}
                          disabled={busy}
                        >
                          Jadikan Primer
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-outline-red"
                        style={{ padding: "3px 8px", fontSize: 11 }}
                        onClick={() => handleRemoveEwallet(ew.provider)}
                        disabled={busy}
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Add new e-wallet ── */}
          {availableToAdd.length > 0 ? (
            <div
              style={{
                background: "#fff",
                border: "1px solid #dde",
                borderRadius: 3,
                padding: "10px 14px",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: "#444", marginBottom: 8 }}>
                + Tambah E-Wallet
              </div>
              <div className="form-row" style={{ marginBottom: 6 }}>

                {/* Bug 2 fix: select is always controlled by addProvider (derived), */}
                {/* and onChange updates selectedProvider which feeds back into addProvider */}
                <div className="fg">
                  <label>Provider</label>
                  <select
                    style={{ width: 130 }}
                    value={addProvider}
                    onChange={(e) => setSelectedProvider(e.target.value)}
                  >
                    {availableToAdd.map((opt) => (
                      <option key={opt.name} value={opt.name}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="fg">
                  <label>No. HP / Akun (opsional)</label>
                  <input
                    type="text"
                    placeholder="081234567890"
                    style={{ width: 155 }}
                    value={addAccount}
                    onChange={(e) => setAddAccount(e.target.value)}
                    maxLength={20}
                  />
                </div>

                <div className="fg">
                  <label>Saldo Awal (Rp)</label>
                  <input
                    type="number"
                    style={{ width: 120 }}
                    value={addBalance}
                    onChange={(e) => setAddBalance(e.target.value)}
                    min={0}
                  />
                </div>

                <div className="fg" style={{ justifyContent: "flex-end" }}>
                  <label style={{ visibility: "hidden" }}>x</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={addPrimary}
                        onChange={(e) => setAddPrimary(e.target.checked)}
                      />
                      Jadikan Primer
                    </label>
                    <button
                      type="button"
                      className="btn btn-blue"
                      onClick={handleAddEwallet}
                      disabled={busy || !addProvider}
                    >
                      Hubungkan
                    </button>
                  </div>
                </div>
              </div>
              <p className="hint">
                Saldo dapat diedit kapan saja. Autodebit mengurangi saldo primer dulu, lalu cadangan jika tidak cukup.
              </p>
            </div>
          ) : (
            <div
              style={{
                background: "#fff",
                border: "1px solid #dde",
                borderRadius: 3,
                padding: "12px 14px",
                textAlign: "center",
                color: "#888",
                fontSize: 13,
              }}
            >
              Semua provider e-wallet sudah terhubung ke kendaraan ini.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
