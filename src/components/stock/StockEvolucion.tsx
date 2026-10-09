"use client";

import { useMemo, useState } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const fmtNum = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
const fmtPct = (n: number) => n.toFixed(1).replace(".", ",") + "%";
const SIN_CATEGORIA = "Sin categoría";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function etiquetaMes(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
}

type Carga = { valor: number; created_at: string };
type Conteo = { valor: number; created_at: string };
type ArticuloHist = { id: string; codigo: string; nombre: string; categoria: string | null; cargasPorMes: Map<string, Carga>; conteos: Conteo[] };

export function StockEvolucion({ movimientos }: { movimientos: AnyRecord[] }) {
  // Reconstruye, por artículo, una carga "oficial" por mes calendario (si
  // subieron el excel dos veces en el mismo mes, se queda con la última) y
  // la lista completa de conteos manuales con su fecha.
  const porArticulo = useMemo(() => {
    const map = new Map<string, ArticuloHist>();
    for (const m of movimientos) {
      const art = (Array.isArray(m.articulo) ? m.articulo[0] : m.articulo) as { id: string; codigo: string; nombre: string; categoria: string | null } | null;
      if (!art) continue;
      if (!map.has(art.id)) {
        map.set(art.id, { id: art.id, codigo: art.codigo, nombre: art.nombre, categoria: art.categoria, cargasPorMes: new Map(), conteos: [] });
      }
      const a = map.get(art.id)!;
      if (m.tipo === "carga_excel") {
        const mes = String(m.created_at).slice(0, 7);
        const prev = a.cargasPorMes.get(mes);
        if (!prev || m.created_at > prev.created_at) a.cargasPorMes.set(mes, { valor: Number(m.valor), created_at: m.created_at });
      } else if (m.tipo === "conteo_manual") {
        a.conteos.push({ valor: Number(m.valor), created_at: m.created_at });
      }
    }
    for (const a of Array.from(map.values())) a.conteos.sort((x: Conteo, y: Conteo) => x.created_at.localeCompare(y.created_at));
    return map;
  }, [movimientos]);

  // Meses con al menos una carga de CUALQUIER artículo — son los "cortes"
  // disponibles para comparar (automático por fecha de la carga, no por
  // confirmación manual).
  const mesesDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const a of Array.from(porArticulo.values())) for (const mes of Array.from(a.cargasPorMes.keys())) set.add(mes);
    return Array.from(set).sort();
  }, [porArticulo]);

  const pares = useMemo(
    () => mesesDisponibles.slice(1).map((mesB, i) => ({ mesA: mesesDisponibles[i], mesB })),
    [mesesDisponibles]
  );

  const [parIdx, setParIdx] = useState(() => Math.max(0, pares.length - 1));
  const par = pares[Math.min(parIdx, pares.length - 1)];

  const comparacion = useMemo(() => {
    if (!par) return null;
    type Fila = { codigo: string; nombre: string; sector: string; stockA: number; conteo: number; stockB: number; diferenciaCorregida: number; diferenciaPersistente: number };
    const filas: Fila[] = [];
    let sinContarEnVentana = 0;
    let altaOBaja = 0;

    for (const a of Array.from(porArticulo.values())) {
      const cargaA = a.cargasPorMes.get(par.mesA);
      const cargaB = a.cargasPorMes.get(par.mesB);
      if (!cargaA || !cargaB) { altaOBaja++; continue; }
      const conteosVentana = a.conteos.filter((c: Conteo) => c.created_at > cargaA.created_at && c.created_at <= cargaB.created_at);
      if (!conteosVentana.length) { sinContarEnVentana++; continue; }
      const ultimo = conteosVentana[conteosVentana.length - 1];
      filas.push({
        codigo: a.codigo, nombre: a.nombre, sector: a.categoria?.trim() || SIN_CATEGORIA,
        stockA: cargaA.valor, conteo: ultimo.valor, stockB: cargaB.valor,
        diferenciaCorregida: ultimo.valor - cargaA.valor,
        diferenciaPersistente: cargaB.valor - ultimo.valor,
      });
    }

    const porSector = new Map<string, { sector: string; comparables: number; corregidos: number; persisten: number }>();
    for (const f of filas) {
      if (!porSector.has(f.sector)) porSector.set(f.sector, { sector: f.sector, comparables: 0, corregidos: 0, persisten: 0 });
      const s = porSector.get(f.sector)!;
      s.comparables += 1;
      if (f.diferenciaPersistente === 0) s.corregidos += 1; else s.persisten += 1;
    }

    const desviosPersistentes = filas.filter((f) => f.diferenciaPersistente !== 0).sort((x, y) => Math.abs(y.diferenciaPersistente) - Math.abs(x.diferenciaPersistente));

    return {
      filas, altaOBaja, sinContarEnVentana,
      porSector: Array.from(porSector.values()).sort((a, b) => b.persisten - a.persisten),
      desviosPersistentes,
      totalComparables: filas.length,
      totalCorregidos: filas.filter((f) => f.diferenciaPersistente === 0).length,
    };
  }, [par, porArticulo]);

  if (mesesDisponibles.length < 2) {
    return (
      <div className="bg-white rounded-[14px] border border-gy200 shadow-sm py-14 text-center text-gy400">
        <i className="ti ti-calendar-time text-[32px] mb-2 block" />
        Todavía no hay dos cargas mensuales para comparar.
        <div className="text-[12px] mt-1">Esto se va a poder ver a partir de la segunda vez que subas el excel de Interpracsys.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-g50/60 border border-g700/20 rounded-[12px] p-3.5 flex items-center gap-3 flex-wrap">
        <i className="ti ti-timeline text-g700 text-[16px]" />
        <span className="text-[13px] font-semibold text-g800">Comparando</span>
        {pares.length > 1 ? (
          <select value={parIdx} onChange={(e) => setParIdx(Number(e.target.value))}
            className="px-2.5 py-1.5 border-2 border-g300 rounded-[8px] text-[12px] bg-white focus:outline-none focus:border-g500">
            {pares.map((p, i) => (
              <option key={i} value={i}>{etiquetaMes(p.mesA)} → {etiquetaMes(p.mesB)}</option>
            ))}
          </select>
        ) : (
          <span className="text-[12px] font-semibold text-g800">{etiquetaMes(par!.mesA)} → {etiquetaMes(par!.mesB)}</span>
        )}
        <span className="text-[11px] text-gy500 ml-auto">
          &quot;{etiquetaMes(par!.mesA)}&quot; = stock subido ese mes · el conteo real es el último contado a mano antes de la carga de &quot;{etiquetaMes(par!.mesB)}&quot;
        </span>
      </div>

      {!comparacion || !comparacion.totalComparables ? (
        <div className="bg-white rounded-[14px] border border-gy200 shadow-sm py-14 text-center text-gy400">
          Ningún artículo tiene un conteo manual cargado entre estas dos fechas — no hay nada para comparar todavía en este período.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <div className="bg-white rounded-[14px] border border-gy200 shadow-sm p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1">Comparables</div>
              <div className="text-2xl font-bold text-gy900">{comparacion.totalComparables}</div>
              <div className="text-[11px] text-gy400">con conteo real en el período</div>
            </div>
            <div className="bg-white rounded-[14px] border border-gy200 shadow-sm p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1">Se corrigieron solos</div>
              <div className="text-2xl font-bold text-g700">{fmtPct((comparacion.totalCorregidos / comparacion.totalComparables) * 100)}</div>
              <div className="text-[11px] text-gy400">el sistema ya coincide con lo contado</div>
            </div>
            <div className="bg-white rounded-[14px] border border-gy200 shadow-sm p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1">Desvío que se repite</div>
              <div className="text-2xl font-bold text-red-600">{comparacion.desviosPersistentes.length}</div>
              <div className="text-[11px] text-gy400">artículos — el sistema no absorbió el ajuste</div>
            </div>
            <div className="bg-white rounded-[14px] border border-gy200 shadow-sm p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1">Sin seguimiento</div>
              <div className="text-2xl font-bold text-gy700">{comparacion.sinContarEnVentana}</div>
              <div className="text-[11px] text-gy400">no se contaron en este período</div>
            </div>
          </div>

          <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gy100">
              <div className="text-[13px] font-semibold text-gy900">Por sector</div>
              <div className="text-[11px] text-gy400">De los artículos contados en el período, cuántos quedaron corregidos y cuántos siguen con desvío</div>
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-gy50 text-[10px] uppercase tracking-wide text-gy400 font-semibold">
                  <th className="px-4 py-2 text-left">Sector</th>
                  <th className="px-4 py-2 text-right">Comparables</th>
                  <th className="px-4 py-2 text-right">Corregidos</th>
                  <th className="px-4 py-2 text-right">Desvío persiste</th>
                </tr>
              </thead>
              <tbody>
                {comparacion.porSector.map((s) => (
                  <tr key={s.sector} className="border-b border-gy100 last:border-0">
                    <td className="px-4 py-2 font-medium text-gy900">{s.sector}</td>
                    <td className="px-4 py-2 text-right text-gy700">{s.comparables}</td>
                    <td className="px-4 py-2 text-right text-g700">{s.corregidos}</td>
                    <td className={`px-4 py-2 text-right font-bold ${s.persisten ? "text-red-600" : "text-gy300"}`}>{s.persisten || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gy100">
              <div className="text-[13px] font-semibold text-gy900">Artículos con desvío que se repite</div>
              <div className="text-[11px] text-gy400">Se corrigió a mano, pero el excel nuevo volvió a traer un valor distinto al que realmente había</div>
            </div>
            {!comparacion.desviosPersistentes.length ? (
              <div className="py-10 text-center text-gy400 text-[12px]">Ninguno — todo lo corregido quedó reflejado en la carga nueva ✓</div>
            ) : (
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-gy50 text-[10px] uppercase tracking-wide text-gy400 font-semibold">
                    <th className="px-4 py-2 text-left">Código</th>
                    <th className="px-4 py-2 text-left">Nombre</th>
                    <th className="px-4 py-2 text-left">Sector</th>
                    <th className="px-4 py-2 text-right">{etiquetaMes(par!.mesA)}</th>
                    <th className="px-4 py-2 text-right">Conteo real</th>
                    <th className="px-4 py-2 text-right">{etiquetaMes(par!.mesB)}</th>
                    <th className="px-4 py-2 text-right">Desvío persistente</th>
                  </tr>
                </thead>
                <tbody>
                  {comparacion.desviosPersistentes.map((f) => (
                    <tr key={f.codigo} className="border-b border-gy100 last:border-0">
                      <td className="px-4 py-2 font-mono text-[11px] text-gy700">{f.codigo}</td>
                      <td className="px-4 py-2 text-gy900">{f.nombre}</td>
                      <td className="px-4 py-2 text-gy500">{f.sector}</td>
                      <td className="px-4 py-2 text-right text-gy600">{fmtNum(f.stockA)}</td>
                      <td className="px-4 py-2 text-right font-semibold text-gy900">{fmtNum(f.conteo)}</td>
                      <td className="px-4 py-2 text-right text-gy600">{fmtNum(f.stockB)}</td>
                      <td className="px-4 py-2 text-right font-bold text-red-600">
                        {f.diferenciaPersistente > 0 ? "+" : ""}{fmtNum(f.diferenciaPersistente)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
