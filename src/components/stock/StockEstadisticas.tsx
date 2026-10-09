"use client";

import { useMemo, useState } from "react";
import { toast } from "@/components/ui/ToastNotification";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const fmtNum = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
const fmtPct = (n: number) => n.toFixed(1).replace(".", ",") + "%";
const SIN_CATEGORIA = "Sin categoría";

type SectorStats = {
  sector: string;
  tipos: number;
  unidadesTotales: number;
  contados: number;
  coinciden: number;
  conDiferencia: number;
  exactitud: number | null; // null = nada contado todavía en ese sector
};

// Banda de color igual al resto del tablero (verde/ámbar/rojo): ≥95% bien,
// ≥85% para revisar, menos que eso es una alerta real de inventario.
function tonoExactitud(pct: number | null): { barra: string; texto: string } {
  if (pct === null) return { barra: "bg-gy300", texto: "text-gy400" };
  if (pct >= 95) return { barra: "bg-g600", texto: "text-g700" };
  if (pct >= 85) return { barra: "bg-amber", texto: "text-amber-text" };
  return { barra: "bg-red-500", texto: "text-red-700" };
}

export function StockEstadisticas({ articulos }: { articulos: AnyRecord[] }) {
  const [generando, setGenerando] = useState(false);
  const [propuestas, setPropuestas] = useState<string | null>(null);

  const porSector = useMemo<SectorStats[]>(() => {
    const map = new Map<string, SectorStats>();
    for (const a of articulos) {
      const sector = (a.categoria as string | null)?.trim() || SIN_CATEGORIA;
      if (!map.has(sector)) {
        map.set(sector, { sector, tipos: 0, unidadesTotales: 0, contados: 0, coinciden: 0, conDiferencia: 0, exactitud: null });
      }
      const s = map.get(sector)!;
      s.tipos += 1;
      s.unidadesTotales += Number(a.stock_sistema ?? 0);
      if (a.stock_real !== null) {
        s.contados += 1;
        if (Number(a.stock_real) === Number(a.stock_sistema)) s.coinciden += 1;
        else s.conDiferencia += 1;
      }
    }
    for (const s of Array.from(map.values())) s.exactitud = s.contados ? (s.coinciden / s.contados) * 100 : null;
    return Array.from(map.values());
  }, [articulos]);

  const totales = useMemo(() => {
    const tipos = porSector.reduce((s, x) => s + x.tipos, 0);
    const unidades = porSector.reduce((s, x) => s + x.unidadesTotales, 0);
    const contados = porSector.reduce((s, x) => s + x.contados, 0);
    const coinciden = porSector.reduce((s, x) => s + x.coinciden, 0);
    const conDiferencia = porSector.reduce((s, x) => s + x.conDiferencia, 0);
    return { tipos, unidades, contados, conDiferencia, exactitud: contados ? (coinciden / contados) * 100 : null };
  }, [porSector]);

  // Ranking de desvíos: los sectores con más diferencias primero (los que
  // más urge revisar), y entre empates, el de peor % de exactitud.
  const rankingDesvios = useMemo(
    () => [...porSector].sort((a, b) => b.conDiferencia - a.conDiferencia || (a.exactitud ?? 100) - (b.exactitud ?? 100)),
    [porSector]
  );
  // Ranking de exactitud: de peor a mejor, para el gráfico de barras. Los
  // sectores sin nada contado todavía van al final (no hay nada que juzgar).
  const rankingExactitud = useMemo(
    () => [...porSector].sort((a, b) => (a.exactitud ?? 101) - (b.exactitud ?? 101)),
    [porSector]
  );
  const maxUnidades = Math.max(1, ...porSector.map((s) => s.unidadesTotales));
  const maxDesvios = Math.max(1, ...porSector.map((s) => s.conDiferencia));

  async function generarPropuestas() {
    setGenerando(true);
    setPropuestas(null);
    const res = await fetch("/api/stock/propuestas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sectores: porSector.map((s) => ({
          sector: s.sector, tipos: s.tipos, unidadesTotales: s.unidadesTotales,
          contados: s.contados, conDiferencia: s.conDiferencia,
          exactitudPct: s.exactitud !== null ? Math.round(s.exactitud * 10) / 10 : null,
        })),
      }),
    });
    const json = await res.json().catch(() => ({}));
    setGenerando(false);
    if (!res.ok) { toast("error", json.error ?? "No se pudo generar el análisis"); return; }
    setPropuestas(json.texto);
  }

  if (!articulos.length) {
    return <div className="py-12 text-center text-gy400">Todavía no hay artículos cargados — subí un excel en la pestaña Bandeja.</div>;
  }

  return (
    <div className="space-y-5">
      {/* Resumen por sector: tipos de producto vs. unidades totales */}
      <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gy100">
          <div className="text-[13px] font-semibold text-gy900">Productos por sector</div>
          <div className="text-[11px] text-gy400">Cantidad de tipos de producto distintos y la suma de unidades que representan</div>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-gy50 text-[10px] uppercase tracking-wide text-gy400 font-semibold">
              <th className="px-4 py-2 text-left">Sector</th>
              <th className="px-4 py-2 text-right">Tipos</th>
              <th className="px-4 py-2 text-right">Unidades totales</th>
              <th className="px-4 py-2 text-left w-[40%]">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {porSector.map((s) => (
              <tr key={s.sector} className="border-b border-gy100 last:border-0">
                <td className="px-4 py-2 font-medium text-gy900">{s.sector}</td>
                <td className="px-4 py-2 text-right text-gy700">{fmtNum(s.tipos)}</td>
                <td className="px-4 py-2 text-right font-semibold text-gy900">{fmtNum(s.unidadesTotales)}</td>
                <td className="px-4 py-2">
                  <div className="h-2 rounded-full bg-gy100 overflow-hidden">
                    <div className="h-full bg-g600 rounded-full" style={{ width: `${(s.unidadesTotales / maxUnidades) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
            <tr className="bg-gy50 font-bold text-gy800">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right">{fmtNum(totales.tipos)}</td>
              <td className="px-4 py-2 text-right">{fmtNum(totales.unidades)}</td>
              <td className="px-4 py-2" />
            </tr>
          </tbody>
        </table>
      </div>

      {/* % de exactitud de inventario por sector */}
      <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gy100">
          <div className="text-[13px] font-semibold text-gy900">% de exactitud de inventario por sector</div>
          <div className="text-[11px] text-gy400">De lo que ya se contó a mano en cada sector, qué porcentaje coincide con el sistema — de peor a mejor</div>
        </div>
        <div className="px-4 py-3 space-y-2.5">
          {rankingExactitud.map((s) => {
            const tono = tonoExactitud(s.exactitud);
            return (
              <div key={s.sector} className="flex items-center gap-3">
                <div className="w-[140px] shrink-0 text-[12px] font-medium text-gy700 truncate">{s.sector}</div>
                <div className="flex-1 h-2.5 rounded-full bg-gy100 overflow-hidden">
                  {s.exactitud !== null && (
                    <div className={`h-full rounded-full ${tono.barra}`} style={{ width: `${s.exactitud}%` }} />
                  )}
                </div>
                <div className={`w-[90px] shrink-0 text-right text-[12px] font-bold ${tono.texto}`}>
                  {s.exactitud !== null ? fmtPct(s.exactitud) : "sin contar"}
                </div>
                <div className="w-[70px] shrink-0 text-right text-[10px] text-gy400">{s.contados}/{s.tipos} cont.</div>
              </div>
            );
          })}
          <div className="pt-2 mt-1 border-t border-gy100 flex items-center gap-3">
            <div className="w-[140px] shrink-0 text-[12px] font-bold text-gy900">Total laboratorio</div>
            <div className="flex-1 h-2.5 rounded-full bg-gy100 overflow-hidden">
              {totales.exactitud !== null && (
                <div className={`h-full rounded-full ${tonoExactitud(totales.exactitud).barra}`} style={{ width: `${totales.exactitud}%` }} />
              )}
            </div>
            <div className={`w-[90px] shrink-0 text-right text-[12px] font-bold ${tonoExactitud(totales.exactitud).texto}`}>
              {totales.exactitud !== null ? fmtPct(totales.exactitud) : "sin contar"}
            </div>
            <div className="w-[70px] shrink-0 text-right text-[10px] text-gy400">{totales.contados}/{totales.tipos}</div>
          </div>
        </div>
      </div>

      {/* Sectores con más desvíos (ranking) */}
      <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gy100">
          <div className="text-[13px] font-semibold text-gy900">Sectores con más desvíos</div>
          <div className="text-[11px] text-gy400">Cantidad de artículos cuyo conteo real no coincide con el sistema</div>
        </div>
        <div className="px-4 py-3 space-y-2.5">
          {rankingDesvios.filter((s) => s.contados > 0).length === 0 ? (
            <div className="text-[12px] text-gy400 py-4 text-center">Todavía no hay ningún sector con artículos contados</div>
          ) : (
            rankingDesvios.filter((s) => s.contados > 0).map((s) => (
              <div key={s.sector} className="flex items-center gap-3">
                <div className="w-[140px] shrink-0 text-[12px] font-medium text-gy700 truncate">{s.sector}</div>
                <div className="flex-1 h-2.5 rounded-full bg-gy100 overflow-hidden">
                  <div className="h-full rounded-full bg-red-500" style={{ width: `${(s.conDiferencia / maxDesvios) * 100}%` }} />
                </div>
                <div className="w-[70px] shrink-0 text-right text-[12px] font-bold text-red-700">{s.conDiferencia}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Propuestas de mejora (IA, a demanda) */}
      <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gy100 flex items-center gap-2">
          <div>
            <div className="text-[13px] font-semibold text-gy900">Propuestas de mejora</div>
            <div className="text-[11px] text-gy400">Análisis generado por IA a partir de estas estadísticas</div>
          </div>
          <button type="button" onClick={generarPropuestas} disabled={generando}
            className="ml-auto flex items-center gap-1.5 px-3.5 py-2 bg-g800 text-white text-[12px] font-semibold rounded-[8px] hover:bg-g700 disabled:opacity-50">
            {generando
              ? <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <i className="ti ti-sparkles text-[14px]" />}
            {propuestas ? "Generar de nuevo" : "Generar propuestas"}
          </button>
        </div>
        <div className="px-4 py-3">
          {propuestas ? (
            <div className="text-[12.5px] text-gy800 whitespace-pre-wrap leading-relaxed">{propuestas}</div>
          ) : (
            <div className="text-[12px] text-gy400 py-4 text-center">Todavía no se generó ningún análisis — tocá &quot;Generar propuestas&quot;</div>
          )}
        </div>
      </div>
    </div>
  );
}
