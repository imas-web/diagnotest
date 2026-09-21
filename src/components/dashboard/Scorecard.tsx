"use client";

import { useMemo, type ReactNode } from "react";
import type { DashData } from "./TableroDireccion";
import { promedioHistoricoMes, mesAnioAnterior } from "@/lib/dashboard/muestrasHistoricas";

type Row = { day: number; cad: number; vet: number; ret: number; mue: number };
type Tone = "ok" | "warn" | "crit";
type Cadence = "semanal" | "mensual";

const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");
const fmtDec = (n: number) => n.toFixed(2).replace(".", ",");
const fmtPct = (n: number) => n.toFixed(1).replace(".", ",") + "%";
const fmtMoney = (n: number) => "$" + Math.round(n).toLocaleString("es-AR");

function dayIndexUTC(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
function dateFromDay(baseDay: number, offset: number): Date {
  return new Date((baseDay + offset) * 86400000);
}

// Semáforo genérico: compara `current` contra `baseline` con una tolerancia.
// betterWhen="higher" → más es mejor (retiros, muestras, % ok...); "lower" →
// menos es mejor (tiempo de control, % sin zona, pendientes...).
function tone(current: number, baseline: number | null, betterWhen: "higher" | "lower", okTol = 0.95, warnTol = 0.85): Tone {
  if (baseline == null || !isFinite(baseline)) return "warn";
  if (baseline === 0) return current === 0 ? "ok" : betterWhen === "higher" ? "ok" : "crit";
  const ratio = betterWhen === "higher" ? current / baseline : baseline / current;
  if (ratio >= okTol) return "ok";
  if (ratio >= warnTol) return "warn";
  return "crit";
}

type Kpi = {
  id: string; label: string; cadence: Cadence;
  value: ReactNode; raw: number;
  metaLabel: string; deltaLabel?: ReactNode;
  tone: Tone;
};

export function Scorecard({ data }: { data: DashData }) {
  const baseDay = useMemo(() => dayIndexUTC(data.baseISO), [data.baseISO]);
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (let i = 0; i < data.rows.length; i += 5) out.push({ day: data.rows[i], cad: data.rows[i + 1], vet: data.rows[i + 2], ret: data.rows[i + 3], mue: data.rows[i + 4] });
    return out;
  }, [data.rows]);
  const maxDay = useMemo(() => rows.reduce((m, r) => Math.max(m, r.day), 0), [rows]);

  const kpis = useMemo(() => {
    function aggRange(f: number, t: number) {
      let ret = 0, mue = 0; const vs = new Set<number>();
      let sinZonaRet = 0;
      for (const r of rows) {
        if (r.day < f || r.day > t) continue;
        ret += r.ret; mue += r.mue; vs.add(r.vet);
        if ((data.vets[r.vet]?.[1] ?? 0) === 0) sinZonaRet += r.ret;
      }
      return { ret, mue, vets: vs.size, sinZonaRet };
    }

    // ---------- SEMANAL: últimos 7 días vs promedio de las 8 semanas previas ----------
    const semF = Math.max(0, maxDay - 6), semT = maxDay;
    const semanaActual = aggRange(semF, semT);
    const semanasPrev: ReturnType<typeof aggRange>[] = [];
    for (let i = 1; i <= 8; i++) {
      const t = semF - 1 - (i - 1) * 7, f = t - 6;
      if (t < 0) break;
      semanasPrev.push(aggRange(Math.max(0, f), t));
    }
    const avgPrevSem = (sel: (a: ReturnType<typeof aggRange>) => number) =>
      semanasPrev.length ? semanasPrev.reduce((s, a) => s + sel(a), 0) / semanasPrev.length : null;

    const baseRet = avgPrevSem((a) => a.ret);
    const baseMue = avgPrevSem((a) => a.mue);
    const baseVets = avgPrevSem((a) => a.vets);
    const baseProd = avgPrevSem((a) => (a.ret ? a.mue / a.ret : 0));
    const prodSemana = semanaActual.ret ? semanaActual.mue / semanaActual.ret : 0;

    const semanales: Kpi[] = [
      {
        id: "ret-sem", label: "Retiros (semana)", cadence: "semanal", raw: semanaActual.ret,
        value: fmt(semanaActual.ret), metaLabel: baseRet != null ? `meta ≈ ${fmt(baseRet)} (prom. 8 sem.)` : "sin historial suficiente",
        tone: tone(semanaActual.ret, baseRet, "higher"),
        deltaLabel: baseRet != null ? deltaTxt(semanaActual.ret, baseRet) : undefined,
      },
      {
        id: "mue-sem", label: "Muestras (semana)", cadence: "semanal", raw: semanaActual.mue,
        value: fmt(semanaActual.mue), metaLabel: baseMue != null ? `meta ≈ ${fmt(baseMue)} (prom. 8 sem.)` : "sin historial suficiente",
        tone: tone(semanaActual.mue, baseMue, "higher"),
        deltaLabel: baseMue != null ? deltaTxt(semanaActual.mue, baseMue) : undefined,
      },
      {
        id: "vet-sem", label: "Veterinarias atendidas (semana)", cadence: "semanal", raw: semanaActual.vets,
        value: fmt(semanaActual.vets), metaLabel: baseVets != null ? `meta ≈ ${fmt(baseVets)} (prom. 8 sem.)` : "sin historial suficiente",
        tone: tone(semanaActual.vets, baseVets, "higher"),
        deltaLabel: baseVets != null ? deltaTxt(semanaActual.vets, baseVets) : undefined,
      },
      {
        id: "prod-sem", label: "Muestras por retiro (semana)", cadence: "semanal", raw: prodSemana,
        value: fmtDec(prodSemana), metaLabel: baseProd != null ? `meta ≈ ${fmtDec(baseProd)} (prom. 8 sem.)` : "sin historial suficiente",
        tone: tone(prodSemana, baseProd, "higher", 0.97, 0.90),
        deltaLabel: baseProd != null ? deltaTxt(prodSemana, baseProd) : undefined,
      },
    ];

    // ---------- MENSUAL ----------
    // El mes en curso está incompleto (recién van N días), así que compararlo
    // contra el TOTAL de meses ya cerrados castigaría siempre al mes actual.
    // En cambio se compara el RITMO diario (total ÷ días transcurridos) contra
    // el ritmo de meses anteriores, y se proyecta ese ritmo a los días que tiene
    // el mes calendario — así "value" y "meta" quedan en la misma escala.
    const monthOf = (d: number) => { const x = dateFromDay(baseDay, d); return x.getUTCFullYear() * 12 + x.getUTCMonth(); };
    const daysInCalendarMonth = (yMonth: number) => {
      const year = Math.floor(yMonth / 12), month = yMonth % 12;
      return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    };
    const curMonth = monthOf(maxDay);
    let mf = maxDay, mt = maxDay;
    for (const r of rows) if (monthOf(r.day) === curMonth) { if (r.day < mf) mf = r.day; if (r.day > mt) mt = r.day; }
    const mesActual = aggRange(mf, mt);
    const diasTranscurridos = mt - mf + 1;
    const diasDelMes = daysInCalendarMonth(curMonth);

    // Meses previos completos disponibles en la plataforma (para retiros/rendimiento, que no tienen historia previa a la plataforma).
    const mesesPrevPlataforma: { agg: ReturnType<typeof aggRange>; dias: number }[] = [];
    const mesesVistos = new Set<number>();
    for (const r of rows) {
      const mo = monthOf(r.day);
      if (mo === curMonth || mesesVistos.has(mo)) continue;
      mesesVistos.add(mo);
      let df = Infinity, dt = -Infinity;
      for (const rr of rows) if (monthOf(rr.day) === mo) { if (rr.day < df) df = rr.day; if (rr.day > dt) dt = rr.day; }
      mesesPrevPlataforma.push({ agg: aggRange(df, dt), dias: dt - df + 1 });
    }
    // Promedia el RITMO diario de cada mes previo (no el total) para no darle
    // más peso a un mes que por casualidad tuvo más días cargados que otro.
    const avgRitmoPrevMes = (sel: (a: ReturnType<typeof aggRange>) => number) =>
      mesesPrevPlataforma.length ? mesesPrevPlataforma.reduce((s, m) => s + sel(m.agg) / m.dias, 0) / mesesPrevPlataforma.length : null;

    const ritmoRetActual = diasTranscurridos ? mesActual.ret / diasTranscurridos : 0;
    const ritmoRetPrev = avgRitmoPrevMes((a) => a.ret);
    const baseRetMes = ritmoRetPrev != null ? ritmoRetPrev * diasDelMes : null; // proyectado a mes completo
    const proyeccionRetMes = ritmoRetActual * diasDelMes;

    const baseProdMes = mesesPrevPlataforma.length
      ? mesesPrevPlataforma.reduce((s, m) => s + (m.agg.ret ? m.agg.mue / m.agg.ret : 0), 0) / mesesPrevPlataforma.length
      : null; // esto ya es un ratio (muestras/retiro), no distorsiona por mes parcial
    const prodMes = mesActual.ret ? mesActual.mue / mesActual.ret : 0;
    const pctSinZonaMes = mesActual.ret ? (mesActual.sinZonaRet / mesActual.ret) * 100 : 0; // también un ratio, sin distorsión
    const basePctSinZonaMes = mesesPrevPlataforma.length
      ? mesesPrevPlataforma.reduce((s, m) => s + (m.agg.ret ? (m.agg.sinZonaRet / m.agg.ret) * 100 : 0), 0) / mesesPrevPlataforma.length
      : null;

    // Muestras (mes): meta con historia real de la planilla (2011–2025, promedio del mismo mes calendario, siempre meses completos).
    const hoy = new Date();
    const mesIdx0 = hoy.getUTCMonth(), anioActual = hoy.getUTCFullYear();
    const metaMuestrasHistCompleta = promedioHistoricoMes(mesIdx0, anioActual, 5);
    const muestrasAnioAnteriorCompleto = mesAnioAnterior(mesIdx0, anioActual);
    const ritmoMueActual = diasTranscurridos ? mesActual.mue / diasTranscurridos : 0;
    const proyeccionMueMes = ritmoMueActual * diasDelMes;

    const mensuales: Kpi[] = [
      {
        id: "mue-mes", label: "Muestras (mes)", cadence: "mensual", raw: proyeccionMueMes,
        value: <>{fmt(mesActual.mue)} <span className="text-[13px] text-gy400 font-normal">a la fecha</span></>,
        metaLabel: metaMuestrasHistCompleta != null
          ? `proyectado a fin de mes: ${fmt(proyeccionMueMes)} · meta ≈ ${fmt(metaMuestrasHistCompleta)} (prom. mismo mes, últimos años)`
          : "sin historia para este mes",
        tone: tone(proyeccionMueMes, metaMuestrasHistCompleta, "higher"),
        deltaLabel: muestrasAnioAnteriorCompleto != null ? (
          <>proyección vs. mismo mes año pasado: {deltaTxt(proyeccionMueMes, muestrasAnioAnteriorCompleto)}</>
        ) : undefined,
      },
      {
        id: "ret-mes", label: "Retiros (mes)", cadence: "mensual", raw: proyeccionRetMes,
        value: <>{fmt(mesActual.ret)} <span className="text-[13px] text-gy400 font-normal">a la fecha</span></>,
        metaLabel: baseRetMes != null
          ? `proyectado a fin de mes: ${fmt(proyeccionRetMes)} · meta ≈ ${fmt(baseRetMes)} (ritmo de meses anteriores)`
          : "sin historial suficiente en la plataforma",
        tone: tone(proyeccionRetMes, baseRetMes, "higher"),
        deltaLabel: baseRetMes != null ? deltaTxt(proyeccionRetMes, baseRetMes) : undefined,
      },
      {
        id: "prod-mes", label: "Muestras por retiro (mes)", cadence: "mensual", raw: prodMes,
        value: fmtDec(prodMes),
        metaLabel: baseProdMes != null ? `meta ≈ ${fmtDec(baseProdMes)} (prom. meses anteriores)` : "sin historial suficiente",
        tone: tone(prodMes, baseProdMes, "higher", 0.97, 0.90),
        deltaLabel: baseProdMes != null ? deltaTxt(prodMes, baseProdMes) : undefined,
      },
      {
        id: "zona-mes", label: "% retiros sin zona (mes)", cadence: "mensual", raw: pctSinZonaMes,
        value: fmtPct(pctSinZonaMes),
        metaLabel: "meta = 0% — requiere vincular veterinaria→zona",
        tone: tone(pctSinZonaMes, 0, "lower", 1, 1) === "ok" ? "ok" : pctSinZonaMes <= 30 ? "warn" : "crit",
        deltaLabel: basePctSinZonaMes != null ? deltaTxt(pctSinZonaMes, basePctSinZonaMes, true) : undefined,
      },
      {
        id: "calidad-mes", label: "Controlado OK (mes)", cadence: "mensual", raw: data.calidad.okPct,
        value: fmtPct(data.calidad.okPct), metaLabel: "meta ≥ 95%",
        tone: data.calidad.okPct >= 95 ? "ok" : data.calidad.okPct >= 90 ? "warn" : "crit",
        deltaLabel: <>mes anterior: {fmtPct(data.calidadPrev.okPct)}</>,
      },
      {
        id: "tiempo-mes", label: "Tiempo de control (mes)", cadence: "mensual", raw: data.calidad.tiempoControlHs,
        value: <>{fmtDec(data.calidad.tiempoControlHs)} hs</>,
        metaLabel: data.calidadPrev.tiempoControlHs ? `meta ≤ ${fmtDec(data.calidadPrev.tiempoControlHs)} hs (mes anterior)` : "ingreso → controlado",
        tone: tone(data.calidad.tiempoControlHs, data.calidadPrev.tiempoControlHs || null, "lower"),
        deltaLabel: data.calidadPrev.tiempoControlHs ? deltaTxt(data.calidad.tiempoControlHs, data.calidadPrev.tiempoControlHs, false, true) : undefined,
      },
      {
        id: "cob-mes", label: "Efectivo validado (mes)", cadence: "mensual",
        raw: data.cobranzas.efectivoDeclarado ? (data.cobranzas.efectivoValidado / data.cobranzas.efectivoDeclarado) * 100 : 0,
        value: fmtPct(data.cobranzas.efectivoDeclarado ? (data.cobranzas.efectivoValidado / data.cobranzas.efectivoDeclarado) * 100 : 0),
        metaLabel: `${fmtMoney(data.cobranzas.efectivoValidado)} de ${fmtMoney(data.cobranzas.efectivoDeclarado)} declarado`,
        tone: tone(
          data.cobranzas.efectivoDeclarado ? data.cobranzas.efectivoValidado / data.cobranzas.efectivoDeclarado : 0,
          data.cobranzasPrev.efectivoDeclarado ? data.cobranzasPrev.efectivoValidado / data.cobranzasPrev.efectivoDeclarado : null,
          "higher", 0.97, 0.90
        ),
        deltaLabel: data.cobranzasPrev.efectivoDeclarado ? (
          <>mes anterior: {fmtPct((data.cobranzasPrev.efectivoValidado / data.cobranzasPrev.efectivoDeclarado) * 100)}</>
        ) : undefined,
      },
    ];

    return { semanales, mensuales };
  }, [rows, maxDay, baseDay, data]);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gy200 rounded-[14px] shadow-sm p-4 text-[12.5px] text-gy600 leading-relaxed">
        <b className="text-gy900">Cómo leer esto:</b> cada indicador se compara contra una <b>meta calculada a partir de la propia historia</b> —
        promedio de semanas o meses anteriores en la plataforma, o el histórico de años previos cuando existe (como &quot;Muestras&quot;, reconstruido
        desde la planilla de estadísticas hasta que la plataforma tomó la posta). 🟢 en meta · 🟡 cerca · 🔴 lejos de la meta.
      </div>

      <KpiGroup title="Indicadores semanales" icon="📅" sub="semana en curso (últimos 7 días) vs. promedio de las últimas semanas" kpis={kpis.semanales} />
      <KpiGroup title="Indicadores mensuales" icon="🗓️" sub="mes en curso vs. meta histórica" kpis={kpis.mensuales} />

      <div className="bg-gy50 border border-dashed border-gy300 rounded-[14px] p-4 text-[12px] text-gy500">
        <b>Pendiente:</b> indicadores de negocio que no salen de la plataforma de logística (ventas, ticket promedio, costos) requieren una fuente
        que se siga actualizando — la planilla histórica que tenías dejó de cargarse en 2021. Si querés sumarlos acá, lo más prolijo es
        conectar un Google Sheet que seguís actualizando vos, y armamos una sección aparte con esos datos.
      </div>
    </div>
  );
}

function deltaTxt(current: number, baseline: number, isPercentPoints = false, lowerIsBetter = false): ReactNode {
  if (isPercentPoints) {
    const diff = current - baseline;
    const cls = (lowerIsBetter ? diff <= 0 : diff >= 0) ? "text-g600" : "text-red-600";
    return <span className={`font-semibold ${cls}`}>{diff >= 0 ? "+" : ""}{diff.toFixed(1).replace(".", ",")} pp vs. referencia</span>;
  }
  if (!baseline) return null;
  const pc = ((current - baseline) / baseline) * 100;
  const good = lowerIsBetter ? pc <= 0 : pc >= 0;
  const cls = good ? "text-g600" : "text-red-600";
  const ar = pc > 2 ? "▲" : pc < -2 ? "▼" : "▬";
  return <span className={`font-semibold ${cls}`}>{ar} {pc >= 0 ? "+" : ""}{pc.toFixed(0)}% vs. referencia</span>;
}

function KpiGroup({ title, icon, sub, kpis }: { title: string; icon: string; sub: string; kpis: Kpi[] }) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-1">
        <span className="text-[15px]">{icon}</span>
        <h2 className="text-[13px] font-bold text-gy900 m-0">{title}</h2>
        <span className="flex-1 h-px bg-gy200" />
      </div>
      <p className="text-[12px] text-gy400 mb-3 mt-0">{sub}</p>
      <div className="grid grid-cols-4 gap-3.5 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
        {kpis.map((k) => <KpiCard key={k.id} kpi={k} />)}
      </div>
    </div>
  );
}

const TONE_BAR: Record<Tone, string> = { ok: "bg-g500", warn: "bg-amber", crit: "bg-red-500" };
const TONE_DOT: Record<Tone, string> = { ok: "bg-g500", warn: "bg-amber", crit: "bg-red-500" };
const TONE_EMOJI: Record<Tone, string> = { ok: "🟢", warn: "🟡", crit: "🔴" };

function KpiCard({ kpi }: { kpi: Kpi }) {
  return (
    <div className="bg-white border border-gy200 rounded-[14px] shadow-sm p-4 relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-[3px] ${TONE_BAR[kpi.tone]}`} />
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${TONE_DOT[kpi.tone]}`} />
        <span className="text-[11.5px] font-semibold text-gy400">{kpi.label}</span>
      </div>
      <div className="text-[26px] font-bold tracking-tight mt-1.5 leading-none">{kpi.value} <span className="text-[13px] align-middle">{TONE_EMOJI[kpi.tone]}</span></div>
      <div className="text-[11px] text-gy400 mt-2">{kpi.metaLabel}</div>
      {kpi.deltaLabel && <div className="text-[11.5px] mt-1.5">{kpi.deltaLabel}</div>}
    </div>
  );
}
