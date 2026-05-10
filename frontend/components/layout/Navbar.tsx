/**
 * components/layout/Navbar.tsx
 * Pixel-accurate SIX ITB navbar built from the real portal source CSS.
 *
 * Real SIX differences vs. our previous version (observed from screenshot):
 *   • Background: #3d3d3d (slightly lighter than #2b2b2b)
 *   • "SIX" brand + home house icon (glyphicon-home via Font Awesome)
 *   • "Aplikasi ▾" "Menu ▾" "Semester X ▾" — Bootstrap dropdown caret style
 *   • Right side: "ID" "EN" plain text — no box, just color change
 *   • User: Bootstrap glyphicon-user circle + name + Bootstrap caret ▾
 *   • All text uses Roboto font
 *   • Height: ~50px (Bootstrap navbar default)
 *   • No border-bottom on the dark bar
 */
"use client";

import Link from "next/link";
import { useState } from "react";

interface NavbarProps {
  userName?: string;
  semester?: string;
  showSemester?: boolean;
}

export function Navbar({
  userName = "Muhammad Abduh",
  semester = "Semester 2 - 2025/2026",
  showSemester = true,
}: NavbarProps) {
  const [lang, setLang] = useState<"ID" | "EN">("ID");

  return (
    <nav
      style={{
        background: "#3d3d3d",
        height: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0",
        position: "sticky",
        top: 0,
        zIndex: 1030,
        width: "100%",
        flexShrink: 0,
        fontFamily: "'Roboto', sans-serif",
      }}
    >
      {/* ── Left: Brand + nav items ── */}
      <div style={{ display: "flex", alignItems: "center", height: "100%" }}>

        {/* SIX + home icon */}
        <Link
          href="/"
          style={{
            color: "#fff",
            fontWeight: 700,
            fontSize: 15,
            padding: "0 16px",
            height: 50,
            display: "flex",
            alignItems: "center",
            gap: 6,
            textDecoration: "none",
            letterSpacing: 1,
            fontFamily: "'Roboto', sans-serif",
          }}
        >
          <span>SIX</span>
          {/* Home icon — Font Awesome fa-home, same as real SIX */}
          <i
            className="fa fa-home"
            style={{ fontSize: 14, opacity: 0.85, marginTop: 1 }}
          />
        </Link>

        {/* Aplikasi */}
        <NavBtn label="Aplikasi" />

        {/* Menu */}
        <NavBtn label="Menu" />

        {/* Semester dropdown — shown only on sub-pages like the real SIX */}
        {showSemester && <NavBtn label={semester} />}
      </div>

      {/* ── Right: ID/EN + user ── */}
      <div style={{ display: "flex", alignItems: "center", height: "100%" }}>

        {/* Language toggle — plain text, no box */}
        {(["ID", "EN"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            style={{
              background: "transparent",
              border: "none",
              color: lang === l ? "#fff" : "#aaa",
              fontWeight: lang === l ? 700 : 400,
              fontSize: 13,
              padding: "0 10px",
              height: 50,
              cursor: "pointer",
              fontFamily: "'Roboto', sans-serif",
              letterSpacing: 0.3,
              transition: "color 0.12s",
            }}
          >
            {l}
          </button>
        ))}

        {/* Thin separator */}
        <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.18)", margin: "0 4px" }} />

        {/* User button — circle icon + name + caret */}
        <button
          type="button"
          style={{
            background: "transparent",
            border: "none",
            color: "#ddd",
            fontSize: 13,
            padding: "0 18px 0 10px",
            height: 50,
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            fontFamily: "'Roboto', sans-serif",
            transition: "color 0.12s",
          }}
        >
          {/* Bootstrap glyphicon-user circle — real SIX uses this */}
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              border: "1.5px solid #aaa",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <i className="fa fa-user" style={{ fontSize: 11, color: "#bbb" }} />
          </span>
          <span>{userName}</span>
          {/* Bootstrap dropdown caret */}
          <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 1 }}>▾</span>
        </button>
      </div>
    </nav>
  );
}

/** Reusable nav button matching real SIX "Aplikasi ▾" style */
function NavBtn({ label }: { label: string }) {
  return (
    <button
      type="button"
      style={{
        background: "transparent",
        border: "none",
        color: "#ddd",
        fontSize: 13,
        padding: "0 14px",
        height: 50,
        display: "flex",
        alignItems: "center",
        gap: 4,
        cursor: "pointer",
        fontFamily: "'Roboto', sans-serif",
        whiteSpace: "nowrap",
        transition: "background 0.12s, color 0.12s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)";
        (e.currentTarget as HTMLButtonElement).style.color = "#fff";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        (e.currentTarget as HTMLButtonElement).style.color = "#ddd";
      }}
    >
      {label}
      <span style={{ fontSize: 10, opacity: 0.65 }}>▾</span>
    </button>
  );
}
