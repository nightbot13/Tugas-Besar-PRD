/**
 * components/parking/TarifInfo.tsx
 * "Informasi Tarif" tab — interactive fee calculator + tariff reference tables.
 */
"use client";

import { useEffect, useState } from "react";

// ── Tarif calculation logic ───────────────────────────────────────────────────
type Kondisi = "harian" | "langganan";
type Jenis   = "motor"  | "mobil";

interface CalcResult {
  total:  number;
  detail: string;
  pct:    number;  // fill % for progress bar
}

function calcTarif(jenis: Jenis, dur: number, kondisi: Kondisi): CalcResult {
  if (kondisi === "langganan") {
    const total = jenis === "motor" ? 32_000 : 120_000;
    return {
      total,
      detail: `Berlangganan ${jenis}: Rp${total.toLocaleString("id-ID")}/bulan (dibayar di awal)`,
      pct: 100,
    };
  }
  if (jenis === "motor") {
    const total = Math.min(1_000 + (dur - 1) * 1_000, 2_000);
    const detail =
      dur === 1
        ? "1 jam pertama: Rp1.000"
        : `1 jam pertama: Rp1.000 + ${dur - 1}× Rp1.000 = Rp${total.toLocaleString("id-ID")} (maks Rp2.000/hari)`;
    return { total, detail, pct: Math.round((total / 2_000) * 100) };
  }
  // mobil
  const total  = Math.min(2_000 + (dur - 1) * 1_000, 10_000);
  const detail =
    dur === 1
      ? "1 jam pertama: Rp2.000"
      : `1 jam pertama: Rp2.000 + ${dur - 1}× Rp1.000 = Rp${total.toLocaleString("id-ID")} (maks Rp10.000/hari)`;
  return { total, detail, pct: Math.round((total / 10_000) * 100) };
}

// ─────────────────────────────────────────────────────────────────────────────
export function TarifInfo() {
  const [jenis,   setJenis]   = useState<Jenis>("motor");
  const [kondisi, setKondisi] = useState<Kondisi>("harian");
  const [dur,     setDur]     = useState(1);
  const [result,  setResult]  = useState<CalcResult>({ total: 1_000, detail: "1 jam pertama: Rp1.000", pct: 50 });

  useEffect(() => {
    setResult(calcTarif(jenis, dur, kondisi));
  }, [jenis, kondisi, dur]);

  return (
    <div>
      {/* ── Interactive calculator ─────────────────────────────────────── */}
      <div className="sec-title">Kalkulator Biaya Parkir</div>
      <div className="card">
        <div className="form-row">
          <div className="fg">
            <label>Jenis Kendaraan</label>
            <select
              style={{ width: 130 }}
              value={jenis}
              onChange={(e) => setJenis(e.target.value as Jenis)}
            >
              <option value="motor">Motor</option>
              <option value="mobil">Mobil</option>
            </select>
          </div>
          <div className="fg">
            <label>Kondisi</label>
            <select
              style={{ width: 150 }}
              value={kondisi}
              onChange={(e) => setKondisi(e.target.value as Kondisi)}
            >
              <option value="harian">Harian</option>
              <option value="langganan">Berlangganan</option>
            </select>
          </div>
          {kondisi === "harian" && (
            <div className="fg">
              <label>Durasi (jam)</label>
              <input
                type="number"
                min={1}
                max={16}
                style={{ width: 80 }}
                value={dur}
                onChange={(e) => setDur(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </div>
          )}
        </div>

        <div className="calc-result-box">
          <div className="calc-main">
            Rp{result.total.toLocaleString("id-ID")}
          </div>
          <div className="calc-detail">{result.detail}</div>
          <div className="progress-bar-bg">
            <div className="progress-bar" style={{ width: `${result.pct}%` }} />
          </div>
        </div>
      </div>

      {/* ── Official tariff cards ──────────────────────────────────────── */}
      <div className="sec-title" style={{ marginTop: 18 }}>Tarif Resmi ITB Jatinangor</div>
      <div className="method-grid">
        <div className="method-card">
          <strong style={{ fontSize: 13, color: "#1a4a80" }}>Motor — Harian</strong>
          <p style={{ fontSize: 12, color: "#555", marginTop: 6, lineHeight: 1.7 }}>
            Jam 1: <strong>Rp1.000</strong><br />
            Jam ke-2 dst: <strong>Rp1.000/jam</strong><br />
            Maksimum: <strong>Rp2.000/hari</strong>
          </p>
        </div>
        <div className="method-card">
          <strong style={{ fontSize: 13, color: "#1a4a80" }}>Mobil — Harian</strong>
          <p style={{ fontSize: 12, color: "#555", marginTop: 6, lineHeight: 1.7 }}>
            Jam 1: <strong>Rp2.000</strong><br />
            Jam ke-2 dst: <strong>Rp1.000/jam</strong><br />
            Maksimum: <strong>Rp10.000/hari</strong>
          </p>
        </div>
        <div className="method-card">
          <strong style={{ fontSize: 13, color: "#1a4a80" }}>Berlangganan</strong>
          <p style={{ fontSize: 12, color: "#555", marginTop: 6, lineHeight: 1.7 }}>
            Motor: <strong>Rp32.000/bulan</strong><br />
            Mobil: <strong>Rp120.000/bulan</strong><br />
            Dibayar di awal bulan
          </p>
        </div>
      </div>

      {/* ── Payment method info ────────────────────────────────────────── */}
      <div className="sec-title" style={{ marginTop: 8 }}>Metode Pembayaran</div>
      <div className="card">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {[
              {
                label:    "Autodebit E-Wallet",
                sub:      "Direkomendasikan",
                subColor: "#27ae60",
                badge:    "badge-green",
                desc:     "Pembayaran otomatis saat kendaraan keluar via ANPR. Mendukung GoPay, OVO, ShopeePay, Dana, dan LinkAja. Saldo dikurangi otomatis — primer terlebih dahulu, lalu cadangan jika tidak cukup. Hubungkan e-wallet di tab Kendaraan Saya.",
              },
              {
                label:    "QRIS Manual",
                sub:      null as string | null,
                subColor: null as string | null,
                badge:    "badge-orange",
                desc:     "Scan QR code di gerbang keluar. Digunakan jika e-wallet tidak terhubung atau saldo tidak mencukupi.",
              },
              {
                label:    "Tunai (Manual Petugas)",
                sub:      null as string | null,
                subColor: null as string | null,
                badge:    "badge-gray",
                desc:     "Pembayaran tunai ke petugas parkir. Hanya tersedia di gerbang yang dijaga.",
              },
            ].map((m, i, arr) => (
              <tr
                key={m.label}
                style={{ borderBottom: i < arr.length - 1 ? "1px solid #f0f0f0" : "none" }}
              >
                <td style={{ width: 200, paddingRight: 16, paddingTop: 10, paddingBottom: 10, verticalAlign: "top", whiteSpace: "nowrap" }}>
                  {/* Tambahkan pembungkus inline-flex di sini */}
                  <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
                    <span className={`badge ${m.badge}`} style={{ fontSize: 11.5, fontWeight: 600 }}>
                      {m.label}
                    </span>
                    {m.sub && (
                      <div style={{ fontSize: 10.5, color: m.subColor ?? "#888", marginTop: 4, fontWeight: 600 }}>
                        {m.sub}
                      </div>
                    )}
                  </div>
                </td>
                <td style={{ fontSize: 12.5, color: "#555", paddingTop: 10, paddingBottom: 10, verticalAlign: "top", lineHeight: 1.6 }}>
                  {m.desc}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── ANPR info box ──────────────────────────────────────────────── */}
      <div className="alert alert-info" style={{ marginTop: 14 }}>
        <strong>Cara kerja sistem ANPR:</strong> Kamera di gerbang masuk dan keluar mendeteksi
        plat nomor secara otomatis. Plat harus terdaftar di sistem dan minimal 85% tingkat
        kepercayaan ANPR agar gerbang terbuka. Jika ANPR gagal, hubungi petugas di pos jaga.
      </div>
    </div>
  );
}
