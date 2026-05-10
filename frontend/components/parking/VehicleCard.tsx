/**
 * components/parking/VehicleCard.tsx
 * Displays a single registered vehicle row.
 * Connected to backend — delete triggers DELETE /api/v1/vehicles/{plate}.
 * Matches Image 3 exactly: plate chip, model, meta text, badge + buttons.
 */
"use client";

import { useState } from "react";
import type { Vehicle } from "@/lib/api";

interface VehicleCardProps {
  vehicle: Vehicle;
  token: string | null;
  onDeleted: (plate: string) => void;
  onEwalletOpen: (plate: string) => void;
}

const EWALLET_COLORS: Record<string, string> = {
  GoPay: "#00aae4",
  OVO:   "#4c3494",
  Dana:  "#108ee9",
  LinkAja: "#e82529",
  ShopeePay: "#f05024",
};

export function VehicleCard({ vehicle, token, onDeleted, onEwalletOpen }: VehicleCardProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!confirm(`Hapus kendaraan ${vehicle.plate_raw}?`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/vehicles/${vehicle.plate_normalized}`,
        {
          method: "DELETE",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail ?? "Gagal menghapus kendaraan.");
      }
      onDeleted(vehicle.plate_normalized);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
      setDeleting(false);
    }
  };

  const isActive   = vehicle.status === "active";
  const isInactive = vehicle.status === "inactive";
  const isParked   = vehicle.is_parked;

  const badgeClass = isActive ? "badge-green" : isInactive ? "badge-orange" : "badge-red";
  const badgeLabel = isActive ? "Aktif" : isInactive ? "Belum Aktif" : "Diblokir";
  const ewalletBtnLabel = vehicle.ewallet ? "Kelola E-Wallet" : "Hubungkan E-Wallet";

  // Build meta line
  const metaParts: string[] = [
    vehicle.vehicle_type === "motor" ? "Motor" : "Mobil",
  ];
  if (vehicle.ewallet) {
    const providers = [vehicle.ewallet.provider];
    if (vehicle.ewallet_backup) providers.push(vehicle.ewallet_backup.provider);
    metaParts.push(`${providers.join(", ")} terhubung`);
  }
  const hasEwallet = !!vehicle.ewallet;

  return (
    <div>
      <div className="vehicle-row">
        {/* Left: plate + info */}
        <div className="v-left">
          <span className="plate">{vehicle.plate_raw}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#333" }}>
              {vehicle.model}
              {isParked && (
                <span
                  className="badge badge-blue"
                  style={{ marginLeft: 8, fontSize: 10, verticalAlign: "middle" }}
                >
                  Sedang Parkir
                </span>
              )}
            </div>
            <div className="v-meta">
              {vehicle.vehicle_type === "motor" ? "Motor" : "Mobil"}
              {hasEwallet && (
                <>
                  {" "}&bull;{" "}
                  {[vehicle.ewallet!.provider, vehicle.ewallet_backup?.provider]
                    .filter(Boolean)
                    .join(", ")}{" "}
                  terhubung
                </>
              )}
              {!hasEwallet && (
                <>
                  {" "}&bull;{" "}
                  <span style={{ color: "#c0392b" }}>Belum ada e-wallet</span>
                </>
              )}
              {vehicle.anpr_verified && (
                <>
                  {" "}&bull;{" "}
                  <span style={{ color: "#27ae60" }}>ANPR Terverifikasi ✓</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: badge + buttons */}
        <div className="v-actions">
          <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
          <button
            type="button"
            className="btn btn-outline-blue"
            onClick={() => onEwalletOpen(vehicle.plate_normalized)}
          >
            {ewalletBtnLabel}
          </button>
          <button
            type="button"
            className="btn btn-outline-red"
            onClick={handleDelete}
            disabled={deleting || isParked}
            title={isParked ? "Tidak dapat dihapus saat kendaraan sedang parkir" : ""}
            style={{ opacity: isParked ? 0.5 : 1, cursor: isParked ? "not-allowed" : "pointer" }}
          >
            {deleting ? "Menghapus..." : "Hapus"}
          </button>
        </div>
      </div>

      {/* Inline error */}
      {error && (
        <div className="alert alert-warn" style={{ marginTop: 6, marginBottom: 6, padding: "6px 12px" }}>
          {error}
        </div>
      )}

      {/* E-wallet detail chips (shown when ewallet exists and panel open) */}
      {vehicle.ewallet && (
        <div
          style={{
            background: "#f5faff",
            border: "1px solid #d6e8f7",
            borderRadius: 3,
            padding: "10px 14px",
            marginBottom: 8,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {[
            { ew: vehicle.ewallet, label: "Primer" },
            vehicle.ewallet_backup ? { ew: vehicle.ewallet_backup, label: "Cadangan" } : null,
          ]
            .filter(Boolean)
            .map(({ ew, label }) => (
              <div
                key={ew!.provider}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#fff",
                  border: "1px solid #c3d9f5",
                  borderRadius: 3,
                  padding: "6px 12px",
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: EWALLET_COLORS[ew!.provider] ?? "#888",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    color: "#fff",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {ew!.provider[0]}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#333" }}>{ew!.provider}</div>
                  <div style={{ fontSize: 11, color: "#31708f" }}>
                    Saldo: Rp{ew!.balance.toLocaleString("id-ID")}
                  </div>
                </div>
                <span className={`badge ${label === "Primer" ? "badge-green" : "badge-gray"}`}>
                  {label}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
