/**
 * components/layout/Navbar.tsx
 *
 * PIXEL-ACCURATE replica dari navbar asli SIX ITB.
 * Dibangun langsung dari source HTML (struktur.html) yang diunggah.
 *
 * HTML asli SIX (disederhanakan):
 * <nav class="navbar navbar-inverse navbar-fixed-top">
 *   <div class="container">
 *     <div class="navbar-header">
 *       <a class="navbar-brand" href="...">SIX <i class="fa fa-home"></i></a>
 *     </div>
 *     <div class="navbar-collapse collapse">
 *       <ul class="nav navbar-nav">
 *         <li class="dropdown"><a>Aplikasi <span class="caret"></span></a></li>
 *         <li class="dropdown"><a>Menu <span class="caret"></span></a></li>
 *       </ul>
 *       <ul class="nav navbar-nav navbar-right">
 *         <li class="active"><a>ID</a></li>
 *         <li><a>EN</a></li>
 *         <li class="dropdown">
 *           <a><span class="fa fa-user-circle-o fa-fw"></span> Muhammad Abduh <span class="caret"></span></a>
 *         </li>
 *       </ul>
 *     </div>
 *   </div>
 * </nav>
 *
 * Bootstrap 3.3.7 .navbar-inverse values (dari bootstrap.min.css):
 *   background-color: #222222
 *   border-color: #080808
 *   height: 50px
 *   .navbar-brand: color #9d9d9d, font-size 18px, padding 15px 15px, font-weight 400
 *   .navbar-nav > li > a: color #9d9d9d, padding 15px
 *   .navbar-nav > li > a:hover: color #fff, background #080808
 *   .navbar-nav > .active > a: color #fff, background #080808
 *   .container: padding 0 15px, max-width 1170px di lg, margin auto
 */
"use client";

import Link from "next/link";
import { useState } from "react";

interface NavbarProps {
  userName?: string;
  showSemester?: boolean;
  semester?: string;
}

export function Navbar({
  userName = "Muhammad Abduh",
  showSemester = false,
  semester = "Semester 2 - 2025/2026",
}: NavbarProps) {
  const [lang, setLang] = useState<"ID" | "EN">("ID");

  return (
    <nav
      className="navbar navbar-inverse"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1030,
        marginBottom: 0,
        /* Bootstrap .navbar-inverse exact values */
        backgroundColor: "#222",
        borderColor: "#080808",
        borderRadius: 0,
        border: "1px solid transparent",
        borderBottomColor: "#080808",
        minHeight: 50,
      }}
    >
      {/* Uses .site-container class — same as breadcrumb wrapper and .page */}
      <div
        className="site-container"
        style={{
          display: "flex",
          alignItems: "stretch",
          minHeight: 50,
          /* Override site-container top/bottom padding for navbar */
          paddingTop: 0,
          paddingBottom: 0,
        }}
      >
        {/* ── navbar-header: brand ── */}
        <div className="navbar-header" style={{ display: "flex", alignItems: "center" }}>
          <Link
            href="/"
            style={{
              /* Bootstrap .navbar-brand exact values */
              float: "left",
              padding: "15px 15px",
              fontSize: 18,
              lineHeight: "20px",
              height: 50,
              /* .navbar-inverse .navbar-brand */
              color: "#9d9d9d",
              fontWeight: 400,          /* NOT bold — real SIX is font-weight normal */
              fontFamily: "'Roboto', sans-serif",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: 5,
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = "#fff";
              (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = "#9d9d9d";
            }}
          >
            SIX
            {/* fa-home — slightly larger for visibility */}
            <i className="fa fa-home" style={{ fontSize: 18 }} />
          </Link>
        </div>

        {/* ── navbar-collapse: nav items ── */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "stretch",
          }}
        >
          {/* LEFT: Aplikasi, Menu, Semester */}
          <ul
            style={{
              display: "flex",
              alignItems: "stretch",
              listStyle: "none",
              margin: 0,
              padding: 0,
              flex: 1,
            }}
          >
            <NavLi label="Aplikasi" />
            <NavLi label="Menu" />
            {showSemester && <NavLi label={semester} />}
          </ul>

          {/* RIGHT: ID, EN, User */}
          <ul
            style={{
              display: "flex",
              alignItems: "stretch",
              listStyle: "none",
              margin: 0,
              padding: 0,
              /* navbar-right floats right in Bootstrap */
              marginLeft: "auto",
            }}
          >
            {/* ID — active state: background #080808, color #fff */}
            <li style={{ display: "flex", alignItems: "stretch" }}>
              <button
                type="button"
                onClick={() => setLang("ID")}
                style={{
                  /* Bootstrap .navbar-nav > li > a */
                  padding: "0 15px",
                  lineHeight: "50px",
                  height: 50,
                  display: "flex",
                  alignItems: "center",
                  border: "none",
                  fontFamily: "'Roboto', sans-serif",
                  fontSize: 14,
                  cursor: "pointer",
                  textDecoration: "none",
                  /* active = #fff on #080808, inactive = #9d9d9d on transparent */
                  color: lang === "ID" ? "#fff" : "#9d9d9d",
                  backgroundColor: lang === "ID" ? "#080808" : "transparent",
                  transition: "background 0.1s, color 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (lang !== "ID") {
                    (e.currentTarget as HTMLElement).style.color = "#fff";
                    (e.currentTarget as HTMLElement).style.backgroundColor = "#080808";
                  }
                }}
                onMouseLeave={(e) => {
                  if (lang !== "ID") {
                    (e.currentTarget as HTMLElement).style.color = "#9d9d9d";
                    (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                  }
                }}
              >
                ID
              </button>
            </li>

            {/* EN */}
            <li style={{ display: "flex", alignItems: "stretch" }}>
              <button
                type="button"
                onClick={() => setLang("EN")}
                style={{
                  padding: "0 15px",
                  height: 50,
                  display: "flex",
                  alignItems: "center",
                  border: "none",
                  fontFamily: "'Roboto', sans-serif",
                  fontSize: 14,
                  cursor: "pointer",
                  color: lang === "EN" ? "#fff" : "#9d9d9d",
                  backgroundColor: lang === "EN" ? "#080808" : "transparent",
                  transition: "background 0.1s, color 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (lang !== "EN") {
                    (e.currentTarget as HTMLElement).style.color = "#fff";
                    (e.currentTarget as HTMLElement).style.backgroundColor = "#080808";
                  }
                }}
                onMouseLeave={(e) => {
                  if (lang !== "EN") {
                    (e.currentTarget as HTMLElement).style.color = "#9d9d9d";
                    (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                  }
                }}
              >
                EN
              </button>
            </li>

            {/* User dropdown — fa-user-circle-o + name + caret */}
            <li style={{ display: "flex", alignItems: "stretch" }}>
              <button
                type="button"
                style={{
                  padding: "0 15px",
                  height: 50,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  border: "none",
                  fontFamily: "'Roboto', sans-serif",
                  fontSize: 14,
                  cursor: "pointer",
                  color: "#9d9d9d",
                  backgroundColor: "transparent",
                  whiteSpace: "nowrap",
                  transition: "background 0.1s, color 0.1s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "#fff";
                  (e.currentTarget as HTMLElement).style.backgroundColor = "#080808";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "#9d9d9d";
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                }}
              >
                {/*
                  Real SIX uses: <span class="fa fa-user-circle-o fa-fw"></span>
                  fa-user-circle-o = outlined user circle, fa-fw = fixed width
                  This renders as a thin circle outline with user silhouette inside
                */}
                <i
                  className="fa fa-user-circle-o fa-fw"
                  style={{ fontSize: 16 }}
                />
                {userName}
                {/* Bootstrap native <span class="caret"> */}
                <span
                  style={{
                    display: "inline-block",
                    width: 0,
                    height: 0,
                    marginLeft: 2,
                    verticalAlign: "middle",
                    borderTop: "4px dashed",
                    borderRight: "4px solid transparent",
                    borderLeft: "4px solid transparent",
                  }}
                />
              </button>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
}

/**
 * Single nav item — Bootstrap .navbar-nav > li > a
 * Real SIX: color #9d9d9d, hover background #080808 color #fff
 * Caret: Bootstrap <span class="caret"> = border-top dashed trick
 */
function NavLi({ label }: { label: string }) {
  return (
    <li style={{ display: "flex", alignItems: "stretch" }}>
      <button
        type="button"
        style={{
          padding: "0 15px",
          height: 50,
          display: "flex",
          alignItems: "center",
          gap: 6,
          border: "none",
          fontFamily: "'Roboto', sans-serif",
          fontSize: 14,
          cursor: "pointer",
          color: "#9d9d9d",
          backgroundColor: "transparent",
          whiteSpace: "nowrap",
          transition: "background 0.1s, color 0.1s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.color = "#fff";
          (e.currentTarget as HTMLElement).style.backgroundColor = "#080808";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.color = "#9d9d9d";
          (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
        }}
      >
        {label}
        <span
          style={{
            display: "inline-block",
            width: 0,
            height: 0,
            marginLeft: 2,
            verticalAlign: "middle",
            borderTop: "4px dashed",
            borderRight: "4px solid transparent",
            borderLeft: "4px solid transparent",
          }}
        />
      </button>
    </li>
  );
}
