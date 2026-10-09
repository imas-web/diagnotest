"use client";

import { useState } from "react";
import { StockBandeja } from "@/components/stock/StockBandeja";
import { StockEstadisticas } from "@/components/stock/StockEstadisticas";
import { StockEvolucion } from "@/components/stock/StockEvolucion";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

type Tab = "bandeja" | "estadisticas" | "evolucion";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "bandeja", label: "Bandeja", icon: "ti-list-details" },
  { id: "estadisticas", label: "Gráficos y estadísticas", icon: "ti-chart-bar" },
  { id: "evolucion", label: "Evolución mensual", icon: "ti-timeline" },
];

export function StockModulo({ articulos, movimientos }: { articulos: AnyRecord[]; movimientos: AnyRecord[] }) {
  const [tab, setTab] = useState<Tab>("bandeja");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-gy200">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${tab === t.id ? "border-g700 text-g700" : "border-transparent text-gy500 hover:text-gy700"}`}>
            <i className={`ti ${t.icon} text-[15px]`} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "bandeja" && <StockBandeja articulos={articulos} />}
      {tab === "estadisticas" && <StockEstadisticas articulos={articulos} />}
      {tab === "evolucion" && <StockEvolucion movimientos={movimientos} />}
    </div>
  );
}
