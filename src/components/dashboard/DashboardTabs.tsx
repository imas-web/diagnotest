"use client";

import { useState, type ReactNode } from "react";

type Tab = "general" | "operativo" | "scorecard";

// Solapas del dashboard de dirección. "General" es el tablero de siempre;
// "Operativo" suma la vista de pendientes de control por día; "Scorecard"
// resume los KPI clave con semáforos y metas (semanal/mensual).
export function DashboardTabs({ general, operativo, scorecard }: { general: ReactNode; operativo: ReactNode; scorecard: ReactNode }) {
  const [tab, setTab] = useState<Tab>("general");

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {([
          { id: "general" as Tab, label: "General", icon: "ti-layout-dashboard" },
          { id: "operativo" as Tab, label: "Operativo", icon: "ti-clipboard-list" },
          { id: "scorecard" as Tab, label: "Scorecard", icon: "ti-gauge" },
        ]).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-[10px] border text-[13px] font-semibold transition-all ${tab === t.id ? "bg-g800 text-white border-g800 shadow-sm" : "bg-white text-gy600 border-gy200 hover:border-g400 hover:text-g700"}`}>
            <i className={`ti ${t.icon} text-[16px]`} />
            {t.label}
          </button>
        ))}
      </div>

      <div className={tab === "general" ? "" : "hidden"}>{general}</div>
      <div className={tab === "operativo" ? "" : "hidden"}>{operativo}</div>
      <div className={tab === "scorecard" ? "" : "hidden"}>{scorecard}</div>
    </div>
  );
}
