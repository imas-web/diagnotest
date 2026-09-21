"use client";

import { useMemo, useState, type ReactNode } from "react";
import { fmtMoneySign } from "@/lib/utils/format";

export type DashData = {
  baseISO: string;
  cadetes: string[];
  zonas: string[]; // [0] = "Sin zona"
  vets: [string, number][]; // [nombre, zonaIdx]
  rows: number[]; // flat [day, cadIdx, vetIdx, retiros, muestras, ...]
  calidad: { okPct: number; observadoPct: number; observadoCount: number; pendientes: number; tiempoControlHs: number };
  cobranzas: { efectivoDeclarado: number; efectivoValidado: number; pendientes: number };
  productividad: { persona: string; count: number }[];
  cargaPorHora: { hora: number; count: number }[];
  calidadPrev: { okPct: number; tiempoControlHs: number };
  cobranzasPrev: { efectivoDeclarado: number; efectivoValidado: number };
};

type Row = { day: number; cad: number; vet: number; ret: number; mue: number };
type Metric = "ret" | "mue" | "vet" | "prod";
type Periodo = "semana" | "mes" | "trimestre" | "todo" | "custom";

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const METRIC_LABEL: Record<Metric, { label: string; sub: string }> = {
  ret: { label: "Retiros", sub: "según el período seleccionado" },
  mue: { label: "Muestras", sub: "según el período seleccionado" },
  vet: { label: "Veterinarias únicas", sub: "según el período seleccionado" },
  prod: { label: "Muestras por retiro", sub: "rendimiento — muestras obtenidas por cada retiro" },
};

const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");
const fmtDec = (n: number) => n.toFixed(2).replace(".", ",");

function dateFromDay(baseDay: number, offset: number): Date {
  return new Date((baseDay + offset) * 86400000);
}
function dayIndexUTC(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

// ---------- Tooltip flotante compartido ----------
function useTooltip() {
  const [tt, setTt] = useState<{ x: number; y: number; html: ReactNode } | null>(null);
  const show = (e: React.MouseEvent, html: ReactNode) => setTt({ x: e.clientX, y: e.clientY, html });
  const move = (e: React.MouseEvent) => setTt((s) => (s ? { ...s, x: e.clientX, y: e.clientY } : s));
  const hide = () => setTt(null);
  const node = tt && (
    <div className="fixed z-50 pointer-events-none bg-gy900 text-white text-[11.5px] font-semibold px-2.5 py-2 rounded-lg shadow-lg font-mono"
      style={{ left: Math.min(tt.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 180), top: tt.y + 16 }}>
      {tt.html}
    </div>
  );
  return { show, move, hide, node };
}

export function TableroDireccion({ data }: { data: DashData }) {
  const baseDay = useMemo(() => dayIndexUTC(data.baseISO), [data.baseISO]);
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (let i = 0; i < data.rows.length; i += 5) {
      out.push({ day: data.rows[i], cad: data.rows[i + 1], vet: data.rows[i + 2], ret: data.rows[i + 3], mue: data.rows[i + 4] });
    }
    return out;
  }, [data.rows]);
  const minDay = 0;
  const maxDay = useMemo(() => rows.reduce((m, r) => Math.max(m, r.day), 0), [rows]);

  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [cad, setCad] = useState(-1);
  const [zona, setZona] = useState(-1);
  const [cmp, setCmp] = useState(false);
  const [metric, setMetric] = useState<Metric>("ret");
  // Por defecto, últimas 4 semanas — así "Personalizado" no arranca vacío mostrando todo el histórico.
  const [customF, setCustomF] = useState<string>(() => isoOfDay(baseDay, Math.max(minDay, maxDay - 27)));
  const [customT, setCustomT] = useState<string>(() => isoOfDay(baseDay, maxDay));
  const tt = useTooltip();

  function range(): [number, number, number | null, number | null] {
    if (periodo === "custom") {
      if (!customF || !customT) return [minDay, maxDay, null, null];
      const f = Math.max(minDay, dayIndexUTC(customF) - baseDay), t = Math.min(maxDay, dayIndexUTC(customT) - baseDay);
      if (f > t) return [minDay, maxDay, null, null];
      const len = t - f + 1, pt = f - 1, pf = pt - len + 1;
      return [f, t, pf >= minDay ? pf : null, pf >= minDay ? pt : null];
    }
    if (periodo === "semana") { const t = maxDay, f = Math.max(minDay, t - 6); return [f, t, f - 7, f - 1]; }
    if (periodo === "mes") {
      const monthOf = (d: number) => { const x = dateFromDay(baseDay, d); return x.getUTCFullYear() * 12 + x.getUTCMonth(); };
      const m = monthOf(maxDay);
      let f = maxDay, t = maxDay;
      for (let d = minDay; d <= maxDay; d++) if (monthOf(d) === m) { f = Math.min(f, d); t = Math.max(t, d); }
      const pm = m - 1; let pf = Infinity, pt = -Infinity;
      for (let d = minDay; d <= maxDay; d++) if (monthOf(d) === pm) { pf = Math.min(pf, d); pt = Math.max(pt, d); }
      return [f, t, pf <= pt ? pf : null, pt];
    }
    return [minDay, maxDay, null, null]; // trimestre / todo
  }

  function agg(f: number, t: number, cadF: number, zonaF: number) {
    let ret = 0, mue = 0; const vs = new Set<number>(), cs = new Set<number>();
    const byCad = new Map<number, number>(), byZona = new Map<number, number>(), byVet = new Map<number, number>(), byZonaMue = new Map<number, number>();
    for (const r of rows) {
      if (r.day < f || r.day > t) continue;
      const z = data.vets[r.vet]?.[1] ?? 0;
      if (cadF >= 0 && r.cad !== cadF) continue;
      if (zonaF >= 0 && z !== zonaF) continue;
      ret += r.ret; mue += r.mue; vs.add(r.vet); cs.add(r.cad);
      byCad.set(r.cad, (byCad.get(r.cad) ?? 0) + r.ret);
      byZona.set(z, (byZona.get(z) ?? 0) + r.ret);
      byVet.set(r.vet, (byVet.get(r.vet) ?? 0) + r.ret);
      byZonaMue.set(z, (byZonaMue.get(z) ?? 0) + r.mue);
    }
    return { ret, mue, vets: vs.size, cads: cs.size, byCad, byZona, byVet, byZonaMue };
  }
  function metricVal(a: { ret: number; mue: number; vets: number }, m: Metric) {
    if (m === "mue") return a.mue; if (m === "vet") return a.vets; if (m === "prod") return a.ret ? a.mue / a.ret : 0; return a.ret;
  }
  function avgCadDay(f: number, t: number, zonaF: number) {
    let sum = 0, days = 0;
    for (let d = f; d <= t; d++) { sum += agg(d, d, -1, zonaF).cads; days++; }
    return days ? sum / days : 0;
  }
  function buckets(f: number, t: number, cadF: number, zonaF: number, m: Metric) {
    const span = t - f + 1; const arr: { label: string; v: number }[] = [];
    if (span <= 14) {
      for (let d = f; d <= t; d++) { const a = agg(d, d, cadF, zonaF); const x = dateFromDay(baseDay, d); arr.push({ label: x.getUTCDate() + "/" + (x.getUTCMonth() + 1), v: metricVal(a, m) }); }
      return { arr, grain: "por día" };
    }
    if (span <= 120) {
      let s = f;
      while (s <= t) { const e = Math.min(t, s + 6); const a = agg(s, e, cadF, zonaF); const x = dateFromDay(baseDay, s); arr.push({ label: x.getUTCDate() + "/" + (x.getUTCMonth() + 1), v: metricVal(a, m) }); s = e + 1; }
      return { arr, grain: "por semana" };
    }
    const monthOf = (d: number) => { const x = dateFromDay(baseDay, d); return x.getUTCFullYear() * 12 + x.getUTCMonth(); };
    const ms = new Set<number>(); for (let d = f; d <= t; d++) ms.add(monthOf(d));
    Array.from(ms).sort((a, b) => a - b).forEach((mo) => {
      let df = Infinity, dt = -Infinity;
      for (let d = f; d <= t; d++) if (monthOf(d) === mo) { df = Math.min(df, d); dt = Math.max(dt, d); }
      const a = agg(df, dt, cadF, zonaF); arr.push({ label: MES[((mo % 12) + 12) % 12], v: metricVal(a, m) });
    });
    return { arr, grain: "por mes" };
  }

  const [f, t, pf, pt] = range();
  const cur = agg(f, t, cad, zona);
  const prev = cmp && pf != null && pt != null ? agg(pf, pt, cad, zona) : null;
  const m = METRIC_LABEL[metric];
  const { arr, grain } = buckets(f, t, cad, zona, metric);
  const mx = Math.max(1, ...arr.map((b) => b.v));
  const fmtM = metric === "prod" ? fmtDec : fmt;
  const zAgg = agg(f, t, cad, -1);
  const avgCad = cad < 0 ? avgCadDay(f, t, zona) : null;

  const x0 = dateFromDay(baseDay, f), x1 = dateFromDay(baseDay, t);
  const perLabel: Record<Periodo, string> = { semana: "últimos 7 días", mes: "mes en curso", trimestre: "trimestre", todo: "histórico completo", custom: "período personalizado" };
  const topCad = Array.from(cur.byCad.entries()).sort((a, b) => b[1] - a[1])[0];
  const sinZona = cur.byZona.get(0) ?? 0;
  const pZona = cur.ret ? Math.round((sinZona / cur.ret) * 100) : 0;

  const first = arr[0]?.v ?? 0, last = arr[arr.length - 1]?.v ?? 0;
  let trendTxt = "Muy poco historial todavía para marcar tendencia.";
  if (arr.length >= 2) {
    const pc = first ? Math.round(((last - first) / first) * 100) : null;
    trendTxt = pc == null ? `De ${fmtM(first)} a ${fmtM(last)} entre el inicio y el fin del período.` : `${pc >= 0 ? "Subió" : "Bajó"} ${Math.abs(pc)}% entre el inicio y el fin del período (${fmtM(first)} → ${fmtM(last)}).`;
  }

  function rankRows(entries: [number, number][], names: string[], flagIdx?: number) {
    const ents = entries.sort((a, b) => b[1] - a[1]).slice(0, 7);
    const max = ents.length ? ents[0][1] : 1;
    if (!ents.length) return <div className="text-[12px] text-gy400 py-2">Sin datos en este filtro</div>;
    return ents.map(([k, v], i) => (
      <div key={k} className="grid grid-cols-[20px_1fr_auto] items-center gap-2.5" onMouseMove={(e) => tt.move(e)}>
        <span className="text-[11px] text-gy400 text-right font-semibold">{k === flagIdx ? "—" : i + 1}</span>
        <div>
          <span className={`text-[13px] truncate block ${k === flagIdx ? "text-red-600 font-medium" : ""}`}>{names[k] ?? "?"}</span>
          <div className="h-[7px] rounded-full bg-gy100 overflow-hidden mt-1">
            <div className={`h-full rounded-full ${k === flagIdx ? "bg-red-500" : "bg-g500"}`} style={{ width: `${Math.round((v / max) * 100)}%` }} />
          </div>
        </div>
        <span className="text-[13px] font-bold font-mono">{fmt(v)}</span>
      </div>
    ));
  }
  function rankRatioRows() {
    const zs = Array.from(zAgg.byZona.keys()).filter((z) => z !== 0 && (zAgg.byZona.get(z) ?? 0) >= 5);
    const ents = zs.map((z) => [z, (zAgg.byZonaMue.get(z) ?? 0) / (zAgg.byZona.get(z) ?? 1)] as [number, number]).sort((a, b) => b[1] - a[1]).slice(0, 7);
    const max = ents.length ? ents[0][1] : 1;
    if (!ents.length) return <div className="text-[12px] text-gy400 py-2">Sin zonas con volumen suficiente</div>;
    return ents.map(([z, v], i) => (
      <div key={z} className="grid grid-cols-[20px_1fr_auto] items-center gap-2.5">
        <span className="text-[11px] text-gy400 text-right font-semibold">{i + 1}</span>
        <div>
          <span className="text-[13px] truncate block">{data.zonas[z]}</span>
          <div className="h-[7px] rounded-full bg-gy100 overflow-hidden mt-1"><div className="h-full rounded-full bg-g500" style={{ width: `${Math.round((v / max) * 100)}%` }} /></div>
        </div>
        <span className="text-[13px] font-bold font-mono">{fmtDec(v)}</span>
      </div>
    ));
  }

  function delta(c: number, p: number | null) {
    if (!cmp || p == null) return null;
    if (p === 0) return <span className="text-g600 font-bold text-[12px]">▲ nuevo</span>;
    const pc = Math.round(((c - p) / p) * 100);
    const cls = pc > 2 ? "text-g600" : pc < -2 ? "text-red-600" : "text-gy400";
    const ar = pc > 2 ? "▲" : pc < -2 ? "▼" : "▬";
    return <span className="text-[12px]"><span className={`font-bold ${cls}`}>{ar} {pc > 0 ? "+" : ""}{pc}%</span> <span className="text-gy400">ant: {fmt(p)}</span></span>;
  }

  return (
    <div className="space-y-5">
      {tt.node}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2.5 bg-white border border-gy200 rounded-[14px] shadow-sm px-3.5 py-3 sticky top-0 z-10">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gy400">Período</span>
        <div className="inline-flex bg-gy50 border border-gy200 rounded-[9px] p-0.5 gap-0.5">
          {([["semana", "Semana"], ["mes", "Mes"], ["trimestre", "Trimestre"], ["todo", "Todo"], ["custom", "Personalizado"]] as [Periodo, string][]).map(([p, l]) => (
            <button key={p} onClick={() => setPeriodo(p)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-md ${periodo === p ? "bg-g800 text-white" : "text-gy600 hover:text-g700"}`}>{l}</button>
          ))}
        </div>
        {periodo === "custom" && (
          <>
            <span className="text-[10px] font-bold uppercase tracking-wide text-gy400">Desde</span>
            <input type="date" value={customF} min={data.baseISO} max={isoOfDay(baseDay, maxDay)} onChange={(e) => setCustomF(e.target.value)}
              className="text-[12px] font-medium border border-gy200 rounded-lg px-2.5 py-1.5 bg-gy50" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-gy400">Hasta</span>
            <input type="date" value={customT} min={data.baseISO} max={isoOfDay(baseDay, maxDay)} onChange={(e) => setCustomT(e.target.value)}
              className="text-[12px] font-medium border border-gy200 rounded-lg px-2.5 py-1.5 bg-gy50" />
          </>
        )}
        <span className="text-[10px] font-bold uppercase tracking-wide text-gy400">Cadete</span>
        <select value={cad} onChange={(e) => setCad(+e.target.value)} className="text-[12px] font-medium border border-gy200 rounded-lg px-2.5 py-1.5 bg-gy50 max-w-[180px]">
          <option value={-1}>Todos</option>
          {data.cadetes.map((n, i) => <option key={i} value={i}>{n}</option>)}
        </select>
        <span className="text-[10px] font-bold uppercase tracking-wide text-gy400">Zona</span>
        <select value={zona} onChange={(e) => setZona(+e.target.value)} className="text-[12px] font-medium border border-gy200 rounded-lg px-2.5 py-1.5 bg-gy50 max-w-[180px]">
          <option value={-1}>Todas las zonas</option>
          {data.zonas.slice(1).map((n, i) => <option key={i + 1} value={i + 1}>{n}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 text-[12px] text-gy600 cursor-pointer select-none ml-1">
          <span className={`w-8 h-[18px] rounded-full relative transition-colors ${cmp ? "bg-g600" : "bg-gy200"}`} onClick={() => setCmp((v) => !v)}>
            <span className={`absolute top-[2px] w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${cmp ? "left-[16px]" : "left-[2px]"}`} />
          </span>
          Comparar vs período anterior
        </label>
      </div>
      <p className="text-[12px] text-gy400 px-0.5">
        Mostrando <b className="text-gy600">{perLabel[periodo]}</b> ({x0.getUTCDate()}/{x0.getUTCMonth() + 1} – {x1.getUTCDate()}/{x1.getUTCMonth() + 1})
        {cad >= 0 && <> · cadete <b className="text-gy600">{data.cadetes[cad]}</b></>}
        {zona >= 0 && <> · zona <b className="text-gy600">{data.zonas[zona]}</b></>}
        {cmp && (pf != null ? <> · comparando vs período anterior</> : <> · sin datos suficientes para comparar</>)}
      </p>

      {/* Logística */}
      <SectionTitle icon="🚚" title="Operación · Logística" />
      <div className="grid grid-cols-4 gap-3.5 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
        <Kpi label="Retiros" value={fmt(cur.ret)} foot={delta(cur.ret, prev?.ret ?? null)} />
        <Kpi label="Muestras" value={fmt(cur.mue)} foot={delta(cur.mue, prev?.mue ?? null)} />
        <Kpi label="Veterinarias únicas" value={fmt(cur.vets)} foot={delta(cur.vets, prev?.vets ?? null)} />
        <Kpi label="Muestras por retiro" value={<>{fmtDec(cur.ret ? cur.mue / cur.ret : 0)} <small className="text-[13px] text-gy400">m/ret</small></>}
          foot={<span className="text-gy400 text-[12px]">{cur.cads} cadete(s) · {fmt(cur.ret / (cur.cads || 1))} retiros c/u</span>} />
      </div>
      {avgCad !== null && (
        <p className="text-[12px] text-gy400 px-0.5"><b className="text-gy600">{fmt(cur.cads)}</b> cadetes distintos trabajaron en el período · promedio de <b className="text-gy600">{avgCad.toFixed(1).replace(".", ",")}</b> activos por día</p>
      )}

      {/* Evolución */}
      <SectionTitle icon="📈" title={<>Evolución <span className="normal-case font-semibold text-gy400">{grain}</span></>} />
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-2.5 mb-1">
          <div><h3 className="text-[14px] font-bold m-0">{m.label}</h3><p className="text-[12px] text-gy400 m-0">{m.sub}</p></div>
          <div className="inline-flex bg-gy50 border border-gy200 rounded-[9px] p-0.5 gap-0.5">
            {([["ret", "Retiros"], ["mue", "Muestras"], ["vet", "Veterinarias"], ["prod", "Muestras/retiro"]] as [Metric, string][]).map(([mk, l]) => (
              <button key={mk} onClick={() => setMetric(mk)} className={`text-[11px] font-semibold px-2.5 py-1 rounded-md ${metric === mk ? "bg-g800 text-white" : "text-gy600 hover:text-g700"}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="flex items-end gap-3 h-[170px] px-1.5 mt-4 overflow-x-auto">
          {arr.map((b, i) => (
            <div key={i} className="flex-1 min-w-[22px] flex flex-col items-center gap-2 h-full justify-end">
              <div className="w-full flex justify-center items-end flex-1">
                <div className="w-full max-w-[40px] rounded-t bg-g600 hover:brightness-110 relative cursor-pointer transition-[height]"
                  style={{ height: `${Math.max(2, Math.round((b.v / mx) * 100))}%` }}
                  onMouseEnter={(e) => tt.show(e, <><b className="font-sans">{b.label}</b><br />{fmtM(b.v)} · {m.label.toLowerCase()}</>)}
                  onMouseMove={(e) => tt.move(e)} onMouseLeave={tt.hide}>
                  <span className="absolute -top-[18px] left-1/2 -translate-x-1/2 text-[11px] font-bold text-gy600 font-mono whitespace-nowrap">{fmtM(b.v)}</span>
                </div>
              </div>
              <div className="text-[11px] font-semibold text-gy600 truncate max-w-full">{b.label}</div>
            </div>
          ))}
        </div>
        <p className="text-[12px] text-gy400 mt-3.5"><span className="text-gy400">Tendencia:</span> {trendTxt}</p>
      </Card>

      {/* Rankings */}
      <SectionTitle icon="🏆" title="Rankings por volumen" />
      <div className="grid grid-cols-4 gap-3.5 items-stretch max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
        <Card><h3 className="text-[14px] font-bold m-0">Cadetes</h3><p className="text-[12px] text-gy400 mb-3.5">Por retiros (respeta período y zona)</p><div className="space-y-2.5">{rankRows(Array.from(agg(f, t, -1, zona).byCad.entries()), data.cadetes, -99)}</div></Card>
        <Card><h3 className="text-[14px] font-bold m-0">Veterinarias</h3><p className="text-[12px] text-gy400 mb-3.5">Por retiros (respeta todos los filtros)</p><div className="space-y-2.5">{rankRows(Array.from(agg(f, t, cad, zona).byVet.entries()), data.vets.map((v) => v[0]), -99)}</div></Card>
        <Card><h3 className="text-[14px] font-bold m-0">Zonas</h3><p className="text-[12px] text-gy400 mb-3.5">Por retiros (respeta período y cadete)</p><div className="space-y-2.5">{rankRows(Array.from(agg(f, t, cad, -1).byZona.entries()), data.zonas, 0)}</div></Card>
        <Card><h3 className="text-[14px] font-bold m-0">Rendimiento por zona</h3><p className="text-[12px] text-gy400 mb-3.5">Muestras/retiro · alerta de pérdida de participación</p><div className="space-y-2.5">{rankRatioRows()}</div></Card>
      </div>

      {/* Insights */}
      <SectionTitle icon="🧠" title="Análisis automático" />
      <Card>
        <div className="space-y-2.5">
          {pZona >= 40 && (
            <InsightItem tone="crit" icon="▲">
              <b>Zonas sin cargar:</b> el {pZona}% de los retiros del filtro caen en &quot;Sin zona&quot;. <em className="not-italic text-gy600">Para que el ranking por zona sea confiable hay que vincular cada <b>veterinaria</b> a su zona (no el cadete, que puede rotar) — así el dato no se mueve si cambia quién la visita.</em>
            </InsightItem>
          )}
          {topCad && cad < 0 && (
            <InsightItem tone="ok" icon="★"><b>{data.cadetes[topCad[0]]}</b> lidera con <b>{fmt(topCad[1])}</b> retiros en el período seleccionado.</InsightItem>
          )}
          <InsightItem tone="ok" icon="✓"><b>Calidad:</b> {data.calidad.okPct.toFixed(1).replace(".", ",")}% controlado OK este mes (dato global, no filtrable).</InsightItem>
          {prev && (
            <InsightItem tone={cur.ret >= prev.ret ? "ok" : "warn"} icon={cur.ret >= prev.ret ? "↗" : "↘"}>
              <b>Variación:</b> {prev.ret ? (cur.ret >= prev.ret ? "+" : "") + Math.round(((cur.ret - prev.ret) / prev.ret) * 100) : 0}% de retiros vs período anterior ({fmt(prev.ret)} → {fmt(cur.ret)}).
            </InsightItem>
          )}
        </div>
      </Card>

      {/* Calidad */}
      <SectionTitle icon="🔬" title="Calidad · Preanalítica" pill="dato global — mes en curso" />
      <div className="grid grid-cols-4 gap-3.5 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
        <Kpi label="Controlado OK" value={data.calidad.okPct.toFixed(1).replace(".", ",") + "%"} foot={<span className="text-gy400 text-[12px]">meta ≥ 95%</span>} />
        <Kpi label="Observados" value={data.calidad.observadoPct.toFixed(2).replace(".", ",") + `% · ${fmt(data.calidad.observadoCount)}`} accent="warn" />
        <Kpi label="Pendientes de control" value={fmt(data.calidad.pendientes)} accent="warn" foot={<span className="text-gy400 text-[12px]">acumulado</span>} />
        <Kpi label="Tiempo de control" value={<>{data.calidad.tiempoControlHs.toFixed(1).replace(".", ",")} <small className="text-[13px] text-gy400">hs</small></>} foot={<span className="text-gy400 text-[12px]">ingreso → controlado</span>} />
      </div>

      {/* Productividad preanalítica */}
      <SectionTitle icon="🧑‍🔬" title="Productividad de Preanalítica" pill="equipo de laboratorio · mes en curso" />
      <div className="grid grid-cols-2 gap-3.5 items-stretch max-[560px]:grid-cols-1">
        <Card>
          <h3 className="text-[14px] font-bold m-0">Muestras controladas por persona</h3>
          <p className="text-[12px] text-gy400 mb-3.5">Quién controla × muestras · mes en curso</p>
          {data.productividad.length ? (
            <div className="space-y-2.5">
              {data.productividad.map((p, i) => (
                <div key={p.persona} className="grid grid-cols-[20px_1fr_auto] items-center gap-2.5">
                  <span className="text-[11px] text-gy400 text-right font-semibold">{i + 1}</span>
                  <div><span className="text-[13px]">{p.persona}</span><div className="h-[7px] rounded-full bg-gy100 overflow-hidden mt-1"><div className="h-full rounded-full bg-g500" style={{ width: `${Math.round((p.count / data.productividad[0].count) * 100)}%` }} /></div></div>
                  <span className="text-[13px] font-bold font-mono">{fmt(p.count)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-[12px] text-gy400">Sin datos este mes.</p>}
        </Card>
        <Card>
          <h3 className="text-[14px] font-bold m-0">Carga por hora del día</h3>
          <p className="text-[12px] text-gy400 mb-3.5">Muestras controladas por franja (hora BA) · el cuello de botella</p>
          <div className="flex items-end gap-2 h-[150px]">
            {data.cargaPorHora.map((h) => {
              const maxH = Math.max(1, ...data.cargaPorHora.map((x) => x.count));
              const pico = h.count === maxH;
              return (
                <div key={h.hora} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                  <div className="w-full flex justify-center items-end flex-1">
                    <div className={`w-full rounded-t relative cursor-pointer ${pico ? "bg-g600" : "bg-g500"}`} style={{ height: `${Math.max(2, Math.round((h.count / maxH) * 100))}%` }}
                      onMouseEnter={(e) => tt.show(e, <><b className="font-sans">{h.hora} hs{pico ? " · pico" : ""}</b><br />{fmt(h.count)} muestras controladas</>)}
                      onMouseMove={(e) => tt.move(e)} onMouseLeave={tt.hide}>
                      {pico && <span className="absolute -top-[18px] left-1/2 -translate-x-1/2 text-[11px] font-bold text-gy600">pico</span>}
                    </div>
                  </div>
                  <div className="text-[11px] font-semibold text-gy600">{h.hora}</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Cobranzas */}
      <SectionTitle icon="💵" title="Cobranzas · solo efectivo" pill="⚠ vista parcial — no incluye otros medios de pago" pillTone="warn" />
      <div className="grid grid-cols-3 gap-3.5 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
        <Kpi label="Efectivo declarado (mes)" value={fmtMoneySign(data.cobranzas.efectivoDeclarado)} accent="warn" />
        <Kpi label="Efectivo validado (mes)" value={fmtMoneySign(data.cobranzas.efectivoValidado)} accent="warn" />
        <Kpi label="Cobranzas pendientes" value={fmt(data.cobranzas.pendientes)} accent="warn" foot={<span className="text-gy400 text-[12px]">sin validar</span>} />
      </div>

      {/* Próximamente */}
      <SectionTitle icon="🗓️" title="Próximamente · a incorporar" />
      <div className="grid grid-cols-2 gap-3.5 max-[560px]:grid-cols-1">
        <div className="bg-gy50 border border-dashed border-gy300 rounded-[14px] p-4">
          <h3 className="text-[14px] font-bold text-gy600 m-0">💰 Costos de retiro ($/muestra)</h3>
          <p className="text-[12px] text-gy400 mt-1 mb-0">Requiere cargar estructura de costos por mes/zona. El volumen ya lo tenemos. <b>Pendiente.</b></p>
        </div>
        <div className="bg-gy50 border border-dashed border-gy300 rounded-[14px] p-4">
          <h3 className="text-[14px] font-bold text-gy600 m-0">🚨 Volumen de siniestros</h3>
          <p className="text-[12px] text-gy400 mt-1 mb-0">Choques/robos por cadete. Necesita un registro nuevo. <b>Pendiente.</b></p>
        </div>
      </div>

      <p className="text-[12px] text-gy400 text-center leading-relaxed mt-2">
        Los filtros de <b>Período · Cadete · Zona</b> recalculan Logística, la evolución y los rankings en vivo, con tooltips al pasar el mouse. &quot;Personalizado&quot; permite elegir cualquier rango de fechas. Calidad, cobranzas y productividad de preanalítica son datos a nivel plataforma (no dependen de cadete/zona).
      </p>
    </div>
  );
}

function isoOfDay(baseDay: number, offset: number) {
  return new Date((baseDay + offset) * 86400000).toISOString().slice(0, 10);
}

function SectionTitle({ icon, title, pill, pillTone }: { icon: string; title: ReactNode; pill?: string; pillTone?: "warn" }) {
  return (
    <div className="flex items-center gap-2.5 pt-2">
      <span className="text-[15px]">{icon}</span>
      <h2 className="text-[12px] font-bold uppercase tracking-wide text-gy600 m-0">{title}</h2>
      <span className="flex-1 h-px bg-gy200" />
      {pill && <span className={`text-[10.5px] px-2.5 py-1 rounded-full border ${pillTone === "warn" ? "text-amber-text bg-amber-bg border-amber/40" : "text-gy400 bg-gy50 border-gy200"}`}>{pill}</span>}
    </div>
  );
}
function Card({ children }: { children: ReactNode }) {
  return <div className="bg-white border border-gy200 rounded-[14px] shadow-sm p-4">{children}</div>;
}
function Kpi({ label, value, foot, accent }: { label: string; value: ReactNode; foot?: ReactNode; accent?: "warn" }) {
  return (
    <div className="bg-white border border-gy200 rounded-[14px] shadow-sm p-4 relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${accent === "warn" ? "bg-amber" : "bg-g500"}`} />
      <div className="text-[11.5px] font-semibold text-gy400">{label}</div>
      <div className="text-[26px] font-bold tracking-tight mt-1.5 leading-none">{value}</div>
      {foot && <div className="mt-2">{foot}</div>}
    </div>
  );
}
function InsightItem({ tone, icon, children }: { tone: "ok" | "warn" | "crit"; icon: string; children: ReactNode }) {
  const toneCls = tone === "crit" ? "bg-red-50 text-red-600" : tone === "warn" ? "bg-amber-bg text-amber-text" : "bg-g50 text-g700";
  return (
    <div className="flex gap-2.5 items-start p-3 rounded-[11px] bg-gy50 border border-gy200">
      <span className={`shrink-0 w-[22px] h-[22px] rounded-[7px] grid place-items-center text-[13px] mt-0.5 ${toneCls}`}>{icon}</span>
      <div className="text-[13px] leading-relaxed">{children}</div>
    </div>
  );
}
