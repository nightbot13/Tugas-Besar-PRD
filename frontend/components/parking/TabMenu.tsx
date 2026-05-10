/**
 * components/parking/TabMenu.tsx
 * Tab switcher bar for the parking page.
 * Preserves the Bootstrap 3 nav-tabs DOM for SIX CSS compatibility.
 */
"use client";

export type TabId = "kendaraan" | "status" | "riwayat" | "tarif";

export const TABS: { id: TabId; label: string }[] = [
  { id: "kendaraan", label: "Kendaraan Saya" },
  { id: "status",    label: "Status Parkir" },
  { id: "riwayat",   label: "Riwayat & Biaya" },
  { id: "tarif",     label: "Informasi Tarif" },
];

interface TabMenuProps {
  active: TabId;
  onChange: (tab: TabId) => void;
}

export function TabMenu({ active, onChange }: TabMenuProps) {
  return (
    <div className="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tab${active === tab.id ? " active" : ""}`}
          onClick={() => onChange(tab.id)}
          aria-selected={active === tab.id}
          role="tab"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
