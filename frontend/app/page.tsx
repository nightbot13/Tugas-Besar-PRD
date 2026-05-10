/**
 * app/parkir/page.tsx
 * Main parking page — fully connected to FastAPI backend.
 *
 * Data flows:
 *   • Vehicle list     → GET  /api/v1/vehicles/       (on mount + after add/delete)
 *   • Add vehicle      → POST /api/v1/vehicles/        (with Indonesian plate validation)
 *   • Delete vehicle   → DELETE /api/v1/vehicles/{plate} (via VehicleCard)
 *   • Status/stats     → GET  /api/v1/vehicles/sessions (via ParkingStatus)
 *   • History          → GET  /api/v1/gate/history     (via HistoryTable)
 *   • Live events      → WS   /ws/gate-events          (via LiveGateEvent)
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { Navbar }        from "@/components/layout/Navbar";
import { Breadcrumb }    from "@/components/layout/Breadcrumb";
import { TabMenu, type TabId } from "@/components/parking/TabMenu";
import { VehicleCard }   from "@/components/parking/VehicleCard";
import { ParkingStatus } from "@/components/parking/ParkingStatus";
import { HistoryTable }  from "@/components/parking/HistoryTable";
import { TarifInfo }     from "@/components/parking/TarifInfo";
import { vehicleApi, validatePlate, type Vehicle, type VehicleType } from "@/lib/api";

// ── Dev token — replace with real auth in production ─────────────────────────
// Generate with: python -c "from core.security import create_dashboard_token; ..."
const DEV_TOKEN = process.env.NEXT_PUBLIC_DASHBOARD_TOKEN ?? null;

// ── Indonesian plate input formatter ─────────────────────────────────────────
function formatPlateInput(raw: string): string {
  // Auto-format as user types: "D1234ITB" → "D 1234 ITB"
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = clean.match(/^([A-Z]{1,2})(\d{0,4})([A-Z]{0,3})$/);
  if (!match) return raw.toUpperCase().slice(0, 12);
  const parts = [match[1], match[2], match[3]].filter(Boolean);
  return parts.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ParkirPage() {
  const token = DEV_TOKEN;

  const [activeTab,    setActiveTab]    = useState<TabId>("kendaraan");
  const [vehicles,     setVehicles]     = useState<Vehicle[]>([]);
  const [vehiclesLoad, setVehiclesLoad] = useState(true);
  const [vehiclesErr,  setVehiclesErr]  = useState<string | null>(null);

  // Add vehicle form state
  const [newPlat,     setNewPlat]     = useState("");
  const [newPlatErr,  setNewPlatErr]  = useState<string | null>(null);
  const [newModel,    setNewModel]    = useState("");
  const [newJenis,    setNewJenis]    = useState<VehicleType>("motor");
  const [addLoading,  setAddLoading]  = useState(false);
  const [addMsg,      setAddMsg]      = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ── Load vehicles from backend ────────────────────────────────────────────
  const loadVehicles = useCallback(async () => {
    if (!token) {
      setVehiclesLoad(false);
      setVehiclesErr("Token tidak tersedia. Set NEXT_PUBLIC_DASHBOARD_TOKEN di .env.local");
      return;
    }
    setVehiclesLoad(true);
    setVehiclesErr(null);
    try {
      const data = await vehicleApi.list(token);
      setVehicles(data);
    } catch (e: unknown) {
      setVehiclesErr(e instanceof Error ? e.message : "Gagal memuat data kendaraan.");
    } finally {
      setVehiclesLoad(false);
    }
  }, [token]);

  useEffect(() => { loadVehicles(); }, [loadVehicles]);

  // ── Plate input handler with auto-format ──────────────────────────────────
  const handlePlatChange = (raw: string) => {
    setNewPlat(formatPlateInput(raw));
    setNewPlatErr(null);
    setAddMsg(null);
  };

  // ── Add vehicle ────────────────────────────────────────────────────────────
  const handleAddVehicle = async () => {
    setAddMsg(null);

    // Client-side plate validation
    const validation = validatePlate(newPlat);
    if (!validation.valid) {
      setNewPlatErr(validation.error ?? "Format plat tidak valid.");
      return;
    }
    if (!newModel.trim()) {
      setAddMsg({ type: "error", text: "Merek / model kendaraan wajib diisi." });
      return;
    }

    setAddLoading(true);
    try {
      const result = await vehicleApi.add(token!, {
        plate_number: validation.normalized!,
        vehicle_type: newJenis,
        model:        newModel.trim(),
      });
      setAddMsg({ type: "success", text: result.message });
      setNewPlat("");
      setNewModel("");
      setNewPlatErr(null);
      // Reload vehicle list from backend
      await loadVehicles();
    } catch (e: unknown) {
      setAddMsg({
        type:  "error",
        text:   e instanceof Error ? e.message : "Gagal mendaftarkan kendaraan.",
      });
    } finally {
      setAddLoading(false);
    }
  };

  // ── Delete vehicle callback ────────────────────────────────────────────────
  const handleDeleted = (plate: string) => {
    setVehicles((v) => v.filter((x) => x.plate_normalized !== plate));
  };

  return (
    <>
      <Navbar userName="Muhammad Abduh" showSemester={false} />

      <Breadcrumb crumbs={[{ label: "SIX", href: "/" }, { label: "Parkir" }]} />

      <div className="page">
        <h1>Parkir</h1>
        <p className="page-subtitle">ITB Jatinangor &mdash; Sistem Parkir ANPR</p>

        <div className="alert alert-info">
          ℹ&ensp;Sistem parkir <strong>ITB Jatinangor</strong> menggunakan{" "}
          <strong>ANPR (Automatic Number Plate Recognition)</strong>. Daftarkan plat nomor
          dan hubungkan e-wallet untuk autodebit otomatis saat keluar.
        </div>

        <TabMenu active={activeTab} onChange={setActiveTab} />

        {/* ══════════════════════════════════════════════════════════════════
            TAB 1 — Kendaraan Saya
        ══════════════════════════════════════════════════════════════════ */}
        <div className={`tab-content${activeTab === "kendaraan" ? " active" : ""}`}>

          {/* Kendaraan Terdaftar */}
          <div className="sec-title">Kendaraan Terdaftar</div>
          <div className="panel">
            <div className="panel-head">Daftar Kendaraan</div>
            <div className="panel-body" style={{ padding: "0 18px" }}>
              {vehiclesLoad && (
                <div style={{ padding: "20px 0", textAlign: "center", color: "#888", fontSize: 13 }}>
                  Memuat data kendaraan...
                </div>
              )}
              {vehiclesErr && (
                <div className="alert alert-warn" style={{ margin: "14px 0" }}>
                  {vehiclesErr}
                </div>
              )}
              {!vehiclesLoad && !vehiclesErr && vehicles.length === 0 && (
                <div style={{ padding: "20px 0", textAlign: "center", color: "#aaa", fontSize: 13 }}>
                  Belum ada kendaraan terdaftar. Daftarkan kendaraan Anda di bawah.
                </div>
              )}
              {!vehiclesLoad && vehicles.map((v) => (
                <VehicleCard
                  key={v.plate_normalized}
                  vehicle={v}
                  token={token}
                  onDeleted={handleDeleted}
                  onEwalletOpen={(plate) => {
                    // TODO: open e-wallet modal for this plate
                    alert(`Kelola E-Wallet untuk ${plate} — fitur segera hadir.`);
                  }}
                />
              ))}
            </div>
          </div>

          {/* Tambah Kendaraan Baru */}
          <div className="sec-title">Tambah Kendaraan Baru</div>
          <div className="card">
            <div className="form-row">

              {/* Plat Nomor with real-time validation */}
              <div className="fg">
                <label>Plat Nomor</label>
                <input
                  type="text"
                  placeholder="Contoh: D 1234 AB"
                  style={{
                    width: 160,
                    borderColor: newPlatErr ? "#c0392b" : undefined,
                    boxShadow: newPlatErr ? "0 0 0 2px rgba(192,57,43,0.15)" : undefined,
                  }}
                  value={newPlat}
                  onChange={(e) => handlePlatChange(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddVehicle()}
                  maxLength={12}
                  autoComplete="off"
                  spellCheck={false}
                />
                {newPlatErr && (
                  <span style={{ fontSize: 11, color: "#c0392b", marginTop: 2 }}>
                    {newPlatErr}
                  </span>
                )}
              </div>

              {/* Jenis */}
              <div className="fg">
                <label>Jenis</label>
                <select
                  style={{ width: 110 }}
                  value={newJenis}
                  onChange={(e) => setNewJenis(e.target.value as VehicleType)}
                >
                  <option value="motor">Motor</option>
                  <option value="mobil">Mobil</option>
                </select>
              </div>

              {/* Merek / Model */}
              <div className="fg">
                <label>Merek / Model</label>
                <input
                  type="text"
                  placeholder="Contoh: Honda Beat"
                  style={{ width: 175 }}
                  value={newModel}
                  onChange={(e) => { setNewModel(e.target.value); setAddMsg(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handleAddVehicle()}
                  maxLength={60}
                />
              </div>

              {/* Submit button */}
              <div className="fg">
                <label style={{ visibility: "hidden" }}>x</label>
                <button
                  type="button"
                  className="btn btn-blue"
                  onClick={handleAddVehicle}
                  disabled={addLoading}
                  style={{ opacity: addLoading ? 0.7 : 1 }}
                >
                  {addLoading ? "Mendaftarkan..." : "+ Daftarkan"}
                </button>
              </div>
            </div>

            {/* Plate format guide */}
            <p className="hint">
              Format plat: 1-2 huruf area + 1-4 angka + 1-3 huruf. 
              Contoh: <strong>B 1234 ABC</strong>, <strong>D 4321 ITB</strong>, <strong>AB 12 CD</strong>.
              Setelah mendaftar, hubungkan e-wallet untuk autodebit otomatis.
            </p>

            {addMsg && (
              <div
                className={`alert ${addMsg.type === "success" ? "alert-success" : "alert-warn"}`}
                style={{ marginTop: 10, marginBottom: 0 }}
              >
                {addMsg.text}
              </div>
            )}
          </div>

          <div className="alert alert-info" style={{ marginTop: 2 }}>
            <strong>Verifikasi ANPR:</strong> Datang ke Pos Jaga Parkir dengan STNK untuk
            verifikasi manual. Kendaraan <em>Belum Aktif</em> tidak dapat menggunakan gerbang otomatis.
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            TAB 2 — Status Parkir
        ══════════════════════════════════════════════════════════════════ */}
        <div className={`tab-content${activeTab === "status" ? " active" : ""}`}>
          <ParkingStatus token={token} totalVehicles={vehicles.length} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            TAB 3 — Riwayat & Biaya
        ══════════════════════════════════════════════════════════════════ */}
        <div className={`tab-content${activeTab === "riwayat" ? " active" : ""}`}>
          <HistoryTable token={token} vehicles={vehicles} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            TAB 4 — Informasi Tarif
        ══════════════════════════════════════════════════════════════════ */}
        <div className={`tab-content${activeTab === "tarif" ? " active" : ""}`}>
          <TarifInfo />
        </div>
      </div>
    </>
  );
}
