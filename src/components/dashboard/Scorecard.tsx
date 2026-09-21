"use client";

import { useMemo, useState, useEffect, type ReactNode } from "react";
import type { DashData } from "./TableroDireccion";
import { MUESTRAS_HISTORICAS, promedioHistoricoMes, mesAnioAnterior } from "@/lib/dashboard/muestrasHistoricas";

type Row = { day: number; cad: number; vet: number; ret: number; mue: number };
type Tone = "ok" | "warn" | "crit";
type Cadence = "semanal" | "mensual";
type Unit = "num" | "dec" | "pct" | "money" | "hs";

const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");
const fmtDec = (n: number) => n.toFixed(2).replace(".", ",");
const fmtPct = (n: number) => n.toFixed(1).replace(".", ",") + "%";
const fmtMoney = (n: number) => "$" + Math.round(n).toLocaleString("es-AR");
const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtByUnit(u: Unit, n: number): string {
  if (u === "dec") return fmtDec(n);
  if (u === "pct") return fmtPct(n);
  if (u === "money") return fmtMoney(n);
  if (u === "hs") return fmtDec(n) + " hs";
  return fmt(n);
}

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

type Period = { label: string; value: number; tone: Tone; nota?: string };
type Kpi = {
  id: string; label: string; cadence: Cadence; unit: Unit;
  value: ReactNode; raw: number;
  metaLabel: string; metaBasis: string; metaValue: number | null;
  deltaLabel?: ReactNode;
  tone: Tone;
  serie: Period[]; // cronológico, más antiguo primero
};

export function Scorecard({ data }: { data: DashData }) {
  const [openId, setOpenId] = useState<string | null>(null);
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
    const lbl = (d: number) => { const x = dateFromDay(baseDay, d); return x.getUTCDate() + "/" + (x.getUTCMonth() + 1); };

    // ---------- SEMANAL: últimos 7 días vs promedio de las 8 semanas previas ----------
    const semF = Math.max(0, maxDay - 6), semT = maxDay;
    const semanaActual = aggRange(semF, semT);
    const semanasPrev: { f: number; t: number; agg: ReturnType<typeof aggRange> }[] = [];
    for (let i = 1; i <= 8; i++) {
      const t = semF - 1 - (i - 1) * 7, f = t - 6;
      if (t < 0) break;
      semanasPrev.push({ f: Math.max(0, f), t, agg: aggRange(Math.max(0, f), t) });
    }
    const avgPrevSem = (sel: (a: ReturnType<typeof aggRange>) => number) =>
      semanasPrev.length ? semanasPrev.reduce((s, w) => s + sel(w.agg), 0) / semanasPrev.length : null;
    const semanasCron = [...semanasPrev].reverse(); // más antigua primero

    function serieSemanal(sel: (a: ReturnType<typeof aggRange>) => number, meta: number | null, betterWhen: "higher" | "lower", okTol = 0.95, warnTol = 0.85): Period[] {
      const past = semanasCron.map((w) => ({ label: `${lbl(w.f)}–${lbl(w.t)}`, value: sel(w.agg), tone: tone(sel(w.agg), meta, betterWhen, okTol, warnTol) }));
      return [...past, { label: `${lbl(semF)}–${lbl(semT)} (actual)`, value: sel(semanaActual), tone: tone(sel(semanaActual), meta, betterWhen, okTol, warnTol) }];
    }

    const baseRet = avgPrevSem((a) => a.ret);
    const baseMue = avgPrevSem((a) => a.mue);
    const baseVets = avgPrevSem((a) => a.vets);
    const baseProd = avgPrevSem((a) => (a.ret ? a.mue / a.ret : 0));
    const prodSemana = semanaActual.ret ? semanaActual.mue / semanaActual.ret : 0;

    const semanales: Kpi[] = [
      {
        id: "ret-sem", label: "Retiros (semana)", cadence: "semanal", unit: "num", raw: semanaActual.ret,
        value: fmt(semanaActual.ret), metaValue: baseRet,
        metaLabel: baseRet != null ? `meta ≈ ${fmt(baseRet)} (prom. 8 sem.)` : "sin historial suficiente",
        metaBasis: "Promedio de retiros de las últimas 8 semanas completas en la plataforma.",
        tone: tone(semanaActual.ret, baseRet, "higher"),
        deltaLabel: baseRet != null ? deltaTxt(semanaActual.ret, baseRet) : undefined,
        serie: serieSemanal((a) => a.ret, baseRet, "higher"),
      },
      {
        id: "mue-sem", label: "Muestras (semana)", cadence: "semanal", unit: "num", raw: semanaActual.mue,
        value: fmt(semanaActual.mue), metaValue: baseMue,
        metaLabel: baseMue != null ? `meta ≈ ${fmt(baseMue)} (prom. 8 sem.)` : "sin historial suficiente",
        metaBasis: "Promedio de muestras de las últimas 8 semanas completas en la plataforma.",
        tone: tone(semanaActual.mue, baseMue, "higher"),
        deltaLabel: baseMue != null ? deltaTxt(semanaActual.mue, baseMue) : undefined,
        serie: serieSemanal((a) => a.mue, baseMue, "higher"),
      },
      {
        id: "vet-sem", label: "Veterinarias atendidas (semana)", cadence: "semanal", unit: "num", raw: semanaActual.vets,
        value: fmt(semanaActual.vets), metaValue: baseVets,
        metaLabel: baseVets != null ? `meta ≈ ${fmt(baseVets)} (prom. 8 sem.)` : "sin historial suficiente",
        metaBasis: "Promedio de veterinarias únicas atendidas en las últimas 8 semanas.",
        tone: tone(semanaActual.vets, baseVets, "higher"),
        deltaLabel: baseVets != null ? deltaTxt(semanaActual.vets, baseVets) : undefined,
        serie: serieSemanal((a) => a.vets, baseVets, "higher"),
      },
      {
        id: "prod-sem", label: "Muestras por retiro (semana)", cadence: "semanal", unit: "dec", raw: prodSemana,
        value: fmtDec(prodSemana), metaValue: baseProd,
        metaLabel: baseProd != null ? `meta ≈ ${fmtDec(baseProd)} (prom. 8 sem.)` : "sin historial suficiente",
        metaBasis: "Rendimiento (muestras ÷ retiros) promedio de las últimas 8 semanas. Tolerancia más ajustada: ±3% verde, ±10% amarillo.",
        tone: tone(prodSemana, baseProd, "higher", 0.97, 0.90),
        deltaLabel: baseProd != null ? deltaTxt(prodSemana, baseProd) : undefined,
        serie: serieSemanal((a) => (a.ret ? a.mue / a.ret : 0), baseProd, "higher", 0.97, 0.90),
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
    const monthLabel = (yMonth: number) => { const year = Math.floor(yMonth / 12), month = yMonth % 12; return `${MES_CORTO[month]} ${year}`; };
    const curMonth = monthOf(maxDay);
    let mf = maxDay, mt = maxDay;
    for (const r of rows) if (monthOf(r.day) === curMonth) { if (r.day < mf) mf = r.day; if (r.day > mt) mt = r.day; }
    const mesActual = aggRange(mf, mt);
    const diasTranscurridos = mt - mf + 1;
    const diasDelMes = daysInCalendarMonth(curMonth);

    // Meses previos completos disponibles en la plataforma (para retiros/rendimiento, que no tienen historia previa a la plataforma).
    const mesesPrevPlataforma: { mo: number; agg: ReturnType<typeof aggRange>; dias: number }[] = [];
    const mesesVistos = new Set<number>();
    for (const r of rows) {
      const mo = monthOf(r.day);
      if (mo === curMonth || mesesVistos.has(mo)) continue;
      mesesVistos.add(mo);
      let df = Infinity, dt = -Infinity;
      for (const rr of rows) if (monthOf(rr.day) === mo) { if (rr.day < df) df = rr.day; if (rr.day > dt) dt = rr.day; }
      mesesPrevPlataforma.push({ mo, agg: aggRange(df, dt), dias: dt - df + 1 });
    }
    mesesPrevPlataforma.sort((a, b) => a.mo - b.mo);
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

    // Serie de "Muestras (mes)": meses previos de la PLATAFORMA + historia de la
    // planilla para los meses anteriores a que existiera la plataforma (hasta 6
    // puntos atrás) — así se ve una evolución larga, no solo los 2-3 meses reales.
    const serieMue: Period[] = [];
    if (mesesPrevPlataforma.length) {
      const primerMesPlataforma = mesesPrevPlataforma[0].mo;
      for (let i = 6; i >= 1; i--) {
        const mo = primerMesPlataforma - i;
        const year = Math.floor(mo / 12), month = mo % 12;
        const v = MUESTRAS_HISTORICAS[year]?.[month];
        if (v == null) continue;
        const metaMes = promedioHistoricoMes(month, year, 5);
        serieMue.push({ label: monthLabel(mo), value: v, tone: tone(v, metaMes, "higher"), nota: "planilla histórica" });
      }
    }
    for (const m of mesesPrevPlataforma) {
      const metaMes = promedioHistoricoMes(m.mo % 12, Math.floor(m.mo / 12), 5);
      serieMue.push({ label: monthLabel(m.mo), value: m.agg.mue, tone: tone(m.agg.mue, metaMes ?? metaMuestrasHistCompleta, "higher") });
    }
    serieMue.push({ label: `${monthLabel(curMonth)} (proyectado)`, value: proyeccionMueMes, tone: tone(proyeccionMueMes, metaMuestrasHistCompleta, "higher"), nota: "mes en curso, proyectado" });

    const serieRet: Period[] = [
      ...mesesPrevPlataforma.map((m) => ({ label: monthLabel(m.mo), value: m.agg.ret, tone: tone(m.agg.ret, baseRetMes, "higher") })),
      { label: `${monthLabel(curMonth)} (proyectado)`, value: proyeccionRetMes, tone: tone(proyeccionRetMes, baseRetMes, "higher"), nota: "mes en curso, proyectado" },
    ];
    const serieProdMes: Period[] = [
      ...mesesPrevPlataforma.map((m) => ({ label: monthLabel(m.mo), value: m.agg.ret ? m.agg.mue / m.agg.ret : 0, tone: tone(m.agg.ret ? m.agg.mue / m.agg.ret : 0, baseProdMes, "higher", 0.97, 0.90) })),
      { label: `${monthLabel(curMonth)} (a la fecha)`, value: prodMes, tone: tone(prodMes, baseProdMes, "higher", 0.97, 0.90) },
    ];
    const serieZonaMes: Period[] = [
      ...mesesPrevPlataforma.map((m) => { const v = m.agg.ret ? (m.agg.sinZonaRet / m.agg.ret) * 100 : 0; return { label: monthLabel(m.mo), value: v, tone: (v <= 5 ? "ok" : v <= 30 ? "warn" : "crit") as Tone }; }),
      { label: `${monthLabel(curMonth)} (a la fecha)`, value: pctSinZonaMes, tone: (pctSinZonaMes <= 5 ? "ok" : pctSinZonaMes <= 30 ? "warn" : "crit") as Tone },
    ];
    const serieCalidad: Period[] = [
      { label: "mes anterior", value: data.calidadPrev.okPct, tone: (data.calidadPrev.okPct >= 95 ? "ok" : data.calidadPrev.okPct >= 90 ? "warn" : "crit") as Tone },
      { label: `${monthLabel(curMonth)} (actual)`, value: data.calidad.okPct, tone: (data.calidad.okPct >= 95 ? "ok" : data.calidad.okPct >= 90 ? "warn" : "crit") as Tone },
    ];
    const serieTiempo: Period[] = data.calidadPrev.tiempoControlHs ? [
      { label: "mes anterior", value: data.calidadPrev.tiempoControlHs, tone: "ok" as Tone },
      { label: `${monthLabel(curMonth)} (actual)`, value: data.calidad.tiempoControlHs, tone: tone(data.calidad.tiempoControlHs, data.calidadPrev.tiempoControlHs, "lower") },
    ] : [{ label: `${monthLabel(curMonth)} (actual)`, value: data.calidad.tiempoControlHs, tone: "ok" as Tone }];
    const cobPrevPct = data.cobranzasPrev.efectivoDeclarado ? (data.cobranzasPrev.efectivoValidado / data.cobranzasPrev.efectivoDeclarado) * 100 : null;
    const cobActualPct = data.cobranzas.efectivoDeclarado ? (data.cobranzas.efectivoValidado / data.cobranzas.efectivoDeclarado) * 100 : 0;
    const serieCob: Period[] = [
      ...(cobPrevPct != null ? [{ label: "mes anterior", value: cobPrevPct, tone: tone(cobPrevPct, cobPrevPct, "higher", 0.97, 0.90) }] : []),
      { label: `${monthLabel(curMonth)} (actual)`, value: cobActualPct, tone: tone(cobActualPct, cobPrevPct, "higher", 0.97, 0.90) },
    ];

    const mensuales: Kpi[] = [
      {
        id: "mue-mes", label: "Muestras (mes)", cadence: "mensual", unit: "num", raw: proyeccionMueMes,
        value: <>{fmt(mesActual.mue)} <span className="text-[13px] text-gy400 font-normal">a la fecha</span></>,
        metaValue: metaMuestrasHistCompleta,
        metaLabel: metaMuestrasHistCompleta != null
          ? `proyectado a fin de mes: ${fmt(proyeccionMueMes)} · meta ≈ ${fmt(metaMuestrasHistCompleta)} (prom. mismo mes, últimos años)`
          : "sin historia para este mes",
        metaBasis: "Promedio del mismo mes calendario en los últimos 5 años (planilla histórica 2011–2025 + plataforma). El valor del mes en curso se proyecta a mes completo según el ritmo diario acumulado.",
        tone: tone(proyeccionMueMes, metaMuestrasHistCompleta, "higher"),
        deltaLabel: muestrasAnioAnteriorCompleto != null ? (
          <>proyección vs. mismo mes año pasado: {deltaTxt(proyeccionMueMes, muestrasAnioAnteriorCompleto)}</>
        ) : undefined,
        serie: serieMue,
      },
      {
        id: "ret-mes", label: "Retiros (mes)", cadence: "mensual", unit: "num", raw: proyeccionRetMes,
        value: <>{fmt(mesActual.ret)} <span className="text-[13px] text-gy400 font-normal">a la fecha</span></>,
        metaValue: baseRetMes,
        metaLabel: baseRetMes != null
          ? `proyectado a fin de mes: ${fmt(proyeccionRetMes)} · meta ≈ ${fmt(baseRetMes)} (ritmo de meses anteriores)`
          : "sin historial suficiente en la plataforma",
        metaBasis: "Ritmo diario promedio de los meses anteriores en la plataforma, proyectado a los días del mes en curso. No hay historia previa a la plataforma para este indicador.",
        tone: tone(proyeccionRetMes, baseRetMes, "higher"),
        deltaLabel: baseRetMes != null ? deltaTxt(proyeccionRetMes, baseRetMes) : undefined,
        serie: serieRet,
      },
      {
        id: "prod-mes", label: "Muestras por retiro (mes)", cadence: "mensual", unit: "dec", raw: prodMes,
        value: fmtDec(prodMes), metaValue: baseProdMes,
        metaLabel: baseProdMes != null ? `meta ≈ ${fmtDec(baseProdMes)} (prom. meses anteriores)` : "sin historial suficiente",
        metaBasis: "Rendimiento promedio (muestras ÷ retiros) de los meses anteriores en la plataforma. Tolerancia ajustada: ±3% verde, ±10% amarillo.",
        tone: tone(prodMes, baseProdMes, "higher", 0.97, 0.90),
        deltaLabel: baseProdMes != null ? deltaTxt(prodMes, baseProdMes) : undefined,
        serie: serieProdMes,
      },
      {
        id: "zona-mes", label: "% retiros sin zona (mes)", cadence: "mensual", unit: "pct", raw: pctSinZonaMes,
        value: fmtPct(pctSinZonaMes), metaValue: 0,
        metaLabel: "meta = 0% — requiere vincular veterinaria→zona",
        metaBasis: "Meta fija en 0%: todo retiro debería poder ubicarse en una zona a través del vínculo veterinaria→zona. Verde ≤5%, amarillo ≤30%, rojo >30%.",
        tone: pctSinZonaMes <= 5 ? "ok" : pctSinZonaMes <= 30 ? "warn" : "crit",
        deltaLabel: basePctSinZonaMes != null ? deltaTxt(pctSinZonaMes, basePctSinZonaMes, true) : undefined,
        serie: serieZonaMes,
      },
      {
        id: "calidad-mes", label: "Controlado OK (mes)", cadence: "mensual", unit: "pct", raw: data.calidad.okPct,
        value: fmtPct(data.calidad.okPct), metaValue: 95,
        metaLabel: "meta ≥ 95%",
        metaBasis: "Meta fija definida en la puesta en marcha del tablero: al menos 95% de lo controlado debe quedar en estado OK (sin observaciones ni rechazos). Verde ≥95%, amarillo ≥90%, rojo <90%.",
        tone: data.calidad.okPct >= 95 ? "ok" : data.calidad.okPct >= 90 ? "warn" : "crit",
        deltaLabel: <>mes anterior: {fmtPct(data.calidadPrev.okPct)}</>,
        serie: serieCalidad,
      },
      {
        id: "tiempo-mes", label: "Tiempo de control (mes)", cadence: "mensual", unit: "hs", raw: data.calidad.tiempoControlHs,
        value: <>{fmtDec(data.calidad.tiempoControlHs)} hs</>, metaValue: data.calidadPrev.tiempoControlHs || null,
        metaLabel: data.calidadPrev.tiempoControlHs ? `meta ≤ ${fmtDec(data.calidadPrev.tiempoControlHs)} hs (mes anterior)` : "ingreso → controlado",
        metaBasis: "Horas promedio desde que logística carga la muestra hasta que preanalítica la controla. La meta es no empeorar respecto al mes anterior (menos es mejor).",
        tone: tone(data.calidad.tiempoControlHs, data.calidadPrev.tiempoControlHs || null, "lower"),
        deltaLabel: data.calidadPrev.tiempoControlHs ? deltaTxt(data.calidad.tiempoControlHs, data.calidadPrev.tiempoControlHs, false, true) : undefined,
        serie: serieTiempo,
      },
      {
        id: "cob-mes", label: "Efectivo validado (mes)", cadence: "mensual", unit: "pct",
        raw: cobActualPct, value: fmtPct(cobActualPct), metaValue: cobPrevPct,
        metaLabel: `${fmtMoney(data.cobranzas.efectivoValidado)} de ${fmtMoney(data.cobranzas.efectivoDeclarado)} declarado`,
        metaBasis: "Porcentaje del efectivo declarado que ya fue validado por cobranzas. La meta es no empeorar respecto al mes anterior; tolerancia ±3% verde, ±10% amarillo.",
        tone: tone(cobActualPct, cobPrevPct, "higher", 0.97, 0.90),
        deltaLabel: cobPrevPct != null ? <>mes anterior: {fmtPct(cobPrevPct)}</> : undefined,
        serie: serieCob,
      },
    ];

    return { semanales, mensuales };
  }, [rows, maxDay, baseDay, data]);

  const allKpis = [...kpis.semanales, ...kpis.mensuales];
  const openKpi = allKpis.find((k) => k.id === openId) ?? null;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gy200 rounded-[14px] shadow-sm p-4 text-[12.5px] text-gy600 leading-relaxed">
        <b className="text-gy900">Cómo leer esto:</b> cada indicador se compara contra una <b>meta calculada a partir de la propia historia</b> —
        promedio de semanas o meses anteriores en la plataforma, o el histórico de años previos cuando existe (como &quot;Muestras&quot;, reconstruido
        desde la planilla de estadísticas hasta que la plataforma tomó la posta). 🟢 en meta · 🟡 cerca · 🔴 lejos de la meta.
        Tocá una tarjeta para ver la evolución período a período.
      </div>

      <KpiGroup title="Indicadores semanales" icon="📅" sub="semana en curso (últimos 7 días) vs. promedio de las últimas semanas" kpis={kpis.semanales} onOpen={setOpenId} />
      <KpiGroup title="Indicadores mensuales" icon="🗓️" sub="mes en curso vs. meta histórica" kpis={kpis.mensuales} onOpen={setOpenId} />

      <ReferenciaScorecard kpis={allKpis} />

      <div className="bg-gy50 border border-dashed border-gy300 rounded-[14px] p-4 text-[12px] text-gy500">
        <b>Pendiente:</b> indicadores de negocio que no salen de la plataforma de logística (ventas, ticket promedio, costos) requieren una fuente
        que se siga actualizando — la planilla histórica que tenías dejó de cargarse en 2021. Si querés sumarlos acá, lo más prolijo es
        conectar un Google Sheet que seguís actualizando vos, y armamos una sección aparte con esos datos.
      </div>

      {openKpi && <SerieModal kpi={openKpi} onClose={() => setOpenId(null)} />}
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

function KpiGroup({ title, icon, sub, kpis, onOpen }: { title: string; icon: string; sub: string; kpis: Kpi[]; onOpen: (id: string) => void }) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-1">
        <span className="text-[15px]">{icon}</span>
        <h2 className="text-[13px] font-bold text-gy900 m-0">{title}</h2>
        <span className="flex-1 h-px bg-gy200" />
      </div>
      <p className="text-[12px] text-gy400 mb-3 mt-0">{sub}</p>
      <div className="grid grid-cols-4 gap-3.5 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
        {kpis.map((k) => <KpiCard key={k.id} kpi={k} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

const TONE_BAR: Record<Tone, string> = { ok: "bg-g500", warn: "bg-amber", crit: "bg-red-500" };
const TONE_DOT: Record<Tone, string> = { ok: "bg-g500", warn: "bg-amber", crit: "bg-red-500" };
const TONE_EMOJI: Record<Tone, string> = { ok: "🟢", warn: "🟡", crit: "🔴" };
const TONE_CELL: Record<Tone, string> = { ok: "bg-g50 text-g700", warn: "bg-amber-bg text-amber-text", crit: "bg-red-50 text-red-600" };

function KpiCard({ kpi, onOpen }: { kpi: Kpi; onOpen: (id: string) => void }) {
  return (
    <button onClick={() => onOpen(kpi.id)}
      className="text-left bg-white border border-gy200 rounded-[14px] shadow-sm p-4 relative overflow-hidden hover:border-g400 hover:shadow-md transition-all cursor-pointer">
      <div className={`absolute top-0 left-0 right-0 h-[3px] ${TONE_BAR[kpi.tone]}`} />
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${TONE_DOT[kpi.tone]}`} />
        <span className="text-[11.5px] font-semibold text-gy400">{kpi.label}</span>
        <i className="ti ti-chart-line text-[13px] text-gy300 ml-auto" />
      </div>
      <div className="text-[26px] font-bold tracking-tight mt-1.5 leading-none">{kpi.value} <span className="text-[13px] align-middle">{TONE_EMOJI[kpi.tone]}</span></div>
      <div className="text-[11px] text-gy400 mt-2">{kpi.metaLabel}</div>
      {kpi.deltaLabel && <div className="text-[11.5px] mt-1.5">{kpi.deltaLabel}</div>}
      <div className="text-[10.5px] text-g700 mt-2.5 font-semibold flex items-center gap-1">
        <i className="ti ti-table text-[12px]" /> Ver evolución
      </div>
    </button>
  );
}

// Modal con la tabla período a período — el "modelo Excel": cada celda coloreada según su semáforo.
function SerieModal({ kpi, onClose }: { kpi: Kpi; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-[16px] shadow-xl max-w-[720px] w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 p-5 border-b border-gy200">
          <div>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${TONE_DOT[kpi.tone]}`} />
              <h3 className="text-[15px] font-bold m-0">{kpi.label}</h3>
            </div>
            <p className="text-[12px] text-gy400 mt-1 mb-0">{kpi.metaBasis}</p>
          </div>
          <button onClick={onClose} className="shrink-0 w-7 h-7 rounded-full hover:bg-gy100 grid place-items-center text-gy500">
            <i className="ti ti-x text-[16px]" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="text-left font-semibold text-gy500 text-[11px] uppercase tracking-wide pb-2 border-b border-gy200">Período</th>
                <th className="text-right font-semibold text-gy500 text-[11px] uppercase tracking-wide pb-2 border-b border-gy200">Valor</th>
                <th className="text-center font-semibold text-gy500 text-[11px] uppercase tracking-wide pb-2 border-b border-gy200">Semáforo</th>
              </tr>
            </thead>
            <tbody>
              {kpi.metaValue != null && (
                <tr className="bg-gy50">
                  <td className="py-2 px-1 font-semibold text-gy600">Meta</td>
                  <td className="py-2 px-1 text-right font-mono font-bold text-gy700">{fmtByUnit(kpi.unit, kpi.metaValue)}</td>
                  <td className="py-2 px-1 text-center text-gy400">—</td>
                </tr>
              )}
              {kpi.serie.map((p, i) => (
                <tr key={i} className="border-b border-gy100 last:border-0">
                  <td className="py-2 px-1">{p.label}{p.nota && <span className="text-gy400"> · {p.nota}</span>}</td>
                  <td className="py-2 px-1 text-right font-mono font-semibold">{fmtByUnit(kpi.unit, p.value)}</td>
                  <td className="py-2 px-1 text-center">
                    <span className={`inline-flex items-center justify-center w-full rounded-md py-1 font-semibold text-[11px] ${TONE_CELL[p.tone]}`}>
                      {TONE_EMOJI[p.tone]} {p.tone === "ok" ? "En meta" : p.tone === "warn" ? "Revisar" : "Fuera de meta"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!kpi.serie.length && <p className="text-[12px] text-gy400 py-6 text-center">Todavía no hay suficiente historia para este indicador.</p>}
        </div>
      </div>
    </div>
  );
}

// "Scorecard completo": la documentación de todos los indicadores en un solo lugar
// (qué cadencia, meta actual y en qué se basa el semáforo) — para que el criterio
// quede explícito y no memorizado.
function ReferenciaScorecard({ kpis }: { kpis: Kpi[] }) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-1">
        <span className="text-[15px]">📖</span>
        <h2 className="text-[13px] font-bold text-gy900 m-0">Scorecard completo — criterios y metas</h2>
        <span className="flex-1 h-px bg-gy200" />
      </div>
      <p className="text-[12px] text-gy400 mb-3 mt-0">Qué mide cada indicador, cuál es su meta y en qué se basa el semáforo.</p>
      <div className="bg-white border border-gy200 rounded-[14px] shadow-sm overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px] min-w-[640px]">
          <thead>
            <tr className="bg-gy50">
              <th className="text-left font-semibold text-gy500 text-[10.5px] uppercase tracking-wide py-2.5 px-4">Indicador</th>
              <th className="text-left font-semibold text-gy500 text-[10.5px] uppercase tracking-wide py-2.5 px-4">Cadencia</th>
              <th className="text-left font-semibold text-gy500 text-[10.5px] uppercase tracking-wide py-2.5 px-4">Meta</th>
              <th className="text-left font-semibold text-gy500 text-[10.5px] uppercase tracking-wide py-2.5 px-4">Base del semáforo</th>
              <th className="text-center font-semibold text-gy500 text-[10.5px] uppercase tracking-wide py-2.5 px-4">Estado</th>
            </tr>
          </thead>
          <tbody>
            {kpis.map((k) => (
              <tr key={k.id} className="border-t border-gy100">
                <td className="py-2.5 px-4 font-medium">{k.label}</td>
                <td className="py-2.5 px-4 text-gy500 capitalize">{k.cadence}</td>
                <td className="py-2.5 px-4 font-mono text-gy700">{k.metaValue != null ? fmtByUnit(k.unit, k.metaValue) : "—"}</td>
                <td className="py-2.5 px-4 text-gy500">{k.metaBasis}</td>
                <td className="py-2.5 px-4 text-center">{TONE_EMOJI[k.tone]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
