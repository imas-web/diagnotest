"use client";

import { useMemo, useState } from "react";
import { StatCard } from "@/components/ui/StatCard";

export interface FilaMovimiento {
  veterinaria: string;
  muestrasActual: number;
  muestrasAnterior: number;
  delta: number;
  pct: number | null;
  nuevo: boolean;
}

const fmtInt = (n: number) => n.toLocaleString("es-AR");
const fmtPctFirmado = (p: number | null) => (p == null ? null : (p > 0 ? "+" : "") + p.toFixed(1).replace(".", ",") + "%");

type SortKey = "veterinaria" | "muestrasActual" | "muestrasAnterior" | "delta" | "pct";

function Panel({
  titulo, filas, tono, rangoActualTxt, rangoAnteriorTxt,
}: {
  titulo: string; filas: FilaMovimiento[]; tono: "up" | "down";
  rangoActualTxt: string; rangoAnteriorTxt: string;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("delta");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(tono === "up" ? "desc" : "asc");

  const top15 = filas.slice(0, 15);
  const maxAbs = Math.max(...top15.map((f) => Math.abs(f.delta)), 1);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    let rows = q ? filas.filter((f) => f.veterinaria.toLowerCase().includes(q)) : filas;
    rows = [...rows].sort((a, b) => {
      const av: string | number = a[sortKey] ?? (sortKey === "pct" ? -Infinity : 0);
      const bv: string | number = b[sortKey] ?? (sortKey === "pct" ? -Infinity : 0);
      if (typeof av === "string" || typeof bv === "string") {
        return sortDir === "asc"
          ? String(a.veterinaria).localeCompare(String(b.veterinaria), "es")
          : String(b.veterinaria).localeCompare(String(a.veterinaria), "es");
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return rows;
  }, [filas, busqueda, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "veterinaria" ? "asc" : "desc"); }
  }

  const barColor = tono === "up" ? "bg-g500" : "bg-red-500";
  const textColor = tono === "up" ? "text-g700" : "text-red-600";
  const headerColor = tono === "up" ? "text-g800" : "text-red-700";

  const cols: { key: SortKey; label: string; align?: "right" }[] = [
    { key: "veterinaria", label: "Veterinaria" },
    { key: "muestrasActual", label: `Muestras (${rangoActualTxt})`, align: "right" },
    { key: "muestrasAnterior", label: `Muestras (${rangoAnteriorTxt})`, align: "right" },
    { key: "delta", label: "Diferencia", align: "right" },
    { key: "pct", label: "%", align: "right" },
  ];

  return (
    <div className="bg-white rounded-[14px] border border-gy200 shadow-sm p-4 md:p-5">
      <div className="flex items-center gap-2 mb-1">
        <i className={`ti ${tono === "up" ? "ti-trending-up" : "ti-trending-down"} text-[18px] ${headerColor}`} />
        <h3 className={`text-[15px] font-bold ${headerColor}`}>{titulo}</h3>
        <span className="text-[11px] text-gy400 ml-auto">top 15 en barra · {filas.length} en la tabla</span>
      </div>

      {/* Ranking visual top 15 */}
      <div className="flex flex-col gap-1 my-3">
        {top15.map((f, i) => (
          <div key={f.veterinaria} className="grid grid-cols-[18px_minmax(0,1.6fr)_minmax(70px,1fr)_60px] items-center gap-2 py-1">
            <span className="text-[10px] text-gy400 font-mono text-right">{i + 1}</span>
            <span className="text-[12.5px] font-medium text-gy800 truncate" title={f.veterinaria}>{f.veterinaria}</span>
            <span className="h-2 rounded-full bg-gy100 overflow-hidden">
              <span className={`block h-full rounded-full ${barColor}`} style={{ width: `${Math.max(4, Math.round((Math.abs(f.delta) / maxAbs) * 100))}%` }} />
            </span>
            <span className={`text-[11px] font-bold font-mono text-right ${textColor}`}>
              {f.nuevo ? "nueva" : fmtPctFirmado(f.pct)}
            </span>
          </div>
        ))}
        {!top15.length && <div className="text-[12px] text-gy400 py-4 text-center">Sin movimientos en este grupo</div>}
      </div>

      {/* Tabla completa, buscable y ordenable */}
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar veterinaria…"
          className="flex-1 px-2.5 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500"
        />
        <span className="text-[11px] text-gy400 whitespace-nowrap">{visibles.length} de {filas.length}</span>
      </div>
      <div className="border border-gy200 rounded-[10px] overflow-hidden">
        <div className="table-scroll">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-gy50">
                {cols.map((c) => (
                  <th key={c.key} onClick={() => toggleSort(c.key)}
                    className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gy400 cursor-pointer select-none hover:text-gy700 whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"}`}>
                    {c.label}
                    {sortKey === c.key && <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.veterinaria} className="hover:bg-gy50 border-b border-gy100 last:border-0">
                  <td className="px-3 py-2 font-medium text-gy900">{f.veterinaria}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtInt(f.muestrasActual)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtInt(f.muestrasAnterior)}</td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold ${f.delta >= 0 ? "text-g700" : "text-red-600"}`}>
                    {f.delta >= 0 ? "+" : ""}{fmtInt(f.delta)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {f.nuevo
                      ? <span className="inline-block text-[10px] font-semibold bg-g50 text-g700 border border-g200 rounded-[5px] px-1.5 py-0.5">nueva</span>
                      : <span className={f.pct! >= 0 ? "text-g700 font-semibold" : "text-red-600 font-semibold"}>{fmtPctFirmado(f.pct)}</span>}
                  </td>
                </tr>
              ))}
              {!visibles.length && (
                <tr><td colSpan={5} className="py-8 text-center text-gy400">Ninguna veterinaria coincide con la búsqueda</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function VeterinariasMovimiento({
  aumentaron, disminuyeron, rangoActualTxt, rangoAnteriorTxt,
}: {
  aumentaron: FilaMovimiento[]; disminuyeron: FilaMovimiento[];
  rangoActualTxt: string; rangoAnteriorTxt: string;
}) {
  const sumar = (filas: FilaMovimiento[]) => ({
    actual: filas.reduce((s, f) => s + f.muestrasActual, 0),
    anterior: filas.reduce((s, f) => s + f.muestrasAnterior, 0),
  });
  const su = sumar(aumentaron), sd = sumar(disminuyeron);
  const pctSu = su.anterior ? Math.round(((su.actual - su.anterior) / su.anterior) * 1000) / 10 : null;
  const pctSd = sd.anterior ? Math.round(((sd.actual - sd.anterior) / sd.anterior) * 1000) / 10 : null;

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-[12px] px-4 py-3 text-[12.5px] text-blue-800 leading-relaxed">
        Comparando <b>{rangoActualTxt}</b> contra <b>{rangoAnteriorTxt}</b> — mismo rango de días en ambos
        meses, para que el mes en curso (todavía sin terminar) se compare parejo contra el anterior.
        No cuenta retiros anulados ni marcados como duplicado sospechoso.
      </div>

      <div className="grid grid-cols-2 gap-3.5 max-[700px]:grid-cols-1">
        <StatCard
          label="Top 100 que más subieron"
          value={pctSu != null ? (pctSu > 0 ? "+" : "") + pctSu.toFixed(1).replace(".", ",") + "%" : "—"}
          sub={`${fmtInt(su.anterior)} → ${fmtInt(su.actual)} muestras entre las ${aumentaron.length}`}
          accent="green"
        />
        <StatCard
          label="Top 100 que más bajaron"
          value={pctSd != null ? pctSd.toFixed(1).replace(".", ",") + "%" : "—"}
          sub={`${fmtInt(sd.anterior)} → ${fmtInt(sd.actual)} muestras entre las ${disminuyeron.length}`}
          accent="danger"
        />
      </div>

      <div className="grid grid-cols-2 gap-3.5 max-[1100px]:grid-cols-1">
        <Panel titulo="Más subieron" filas={aumentaron} tono="up" rangoActualTxt={rangoActualTxt} rangoAnteriorTxt={rangoAnteriorTxt} />
        <Panel titulo="Más bajaron" filas={disminuyeron} tono="down" rangoActualTxt={rangoActualTxt} rangoAnteriorTxt={rangoAnteriorTxt} />
      </div>
    </div>
  );
}
