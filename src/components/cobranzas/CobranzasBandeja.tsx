"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ControlCard } from "@/components/ui/ControlCard";
import { exportToExcel } from "@/lib/utils/export";
import { toast } from "@/components/ui/ToastNotification";
import { fmtMoneySign } from "@/lib/utils/format";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

type Filtro = "todos" | "urgentes" | "personal";
const FILTROS: { id: Filtro; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "urgentes", label: "Urgentes primero" },
  { id: "personal", label: "Por personal" },
];
const esUrgente = (c: AnyRecord) => c.urgente || c.retiro?.urgente;

// La búsqueda por veterinaria/código y la fecha se resuelven EN EL SERVIDOR (via
// GET) para no traer las ~900 pendientes de una — eso trababa el navegador. Se
// muestran de a `ver`; "Mostrar más" sube ese número. Las solapas
// (Todos/Urgentes/Por personal) agrupan lo ya cargado en el cliente.
export function CobranzasBandeja({
  controles, total, q, fecha, cadete, cadetes, ver,
}: {
  controles: AnyRecord[]; total: number; q: string; fecha: string;
  cadete: string; cadetes: { id: string; nombre: string }[]; ver: number;
}) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [modoSeleccion, setModoSeleccion] = useState(false);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [adjudicando, setAdjudicando] = useState<{ hecho: number; total: number } | null>(null);

  const ordenados = useMemo(() => {
    const arr = [...controles];
    if (filtro === "urgentes") arr.sort((a, b) => Number(esUrgente(b)) - Number(esUrgente(a)));
    else if (filtro === "personal") arr.sort((a, b) =>
      String(a.retiro?.personal?.nombre ?? "~").localeCompare(String(b.retiro?.personal?.nombre ?? "~"), "es"));
    return arr;
  }, [controles, filtro]);

  const grupos = useMemo(() => {
    if (filtro !== "personal") return null;
    const map = new Map<string, AnyRecord[]>();
    for (const c of ordenados) {
      const k = c.retiro?.personal?.nombre ?? "Sin asignar";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    return Array.from(map.entries());
  }, [ordenados, filtro]);

  const hayMas = controles.length < total;
  const masHref = { pathname: "/cobranzas", query: { ...(q ? { q } : {}), ...(fecha ? { fecha } : {}), ...(cadete ? { cadete } : {}), ver: ver + 50 } };

  const idsVisibles = useMemo(() => ordenados.map((c: AnyRecord) => c.id as string), [ordenados]);

  function toggleSeleccion(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function seleccionarTodos() { setSeleccionados(new Set(idsVisibles)); }
  function salirDeSeleccion() { setModoSeleccion(false); setSeleccionados(new Set()); }

  // Adjudica varias cobranzas de una — mismo criterio que el botón individual
  // de cada ficha: confirma el importe declarado tal cual, sin diferencias
  // (si alguna tiene una diferencia real, se resuelve aparte, no acá). Va una
  // por una (no en paralelo) porque cada adjudicación genera un recibo real
  // en Interpracsys — no conviene mandarle ráfagas, y así se puede mostrar
  // el progreso mientras corre.
  async function adjudicarSeleccionados() {
    const items = ordenados.filter((c: AnyRecord) => seleccionados.has(c.id));
    if (!items.length) return;
    const montoTotal = items.reduce((s: number, c: AnyRecord) => s + (Number(c.retiro?.importe_declarado) || 0), 0);
    const ok = window.confirm(
      `¿Adjudicar ${items.length} cobranza(s) por un total de ${fmtMoneySign(montoTotal)}?\n\n` +
      "Se confirma el importe declarado tal cual (sin diferencias) y se genera un recibo en Interpracsys " +
      "por cada una. Si alguna tiene una diferencia real, resolvela individual en vez de incluirla acá."
    );
    if (!ok) return;

    setAdjudicando({ hecho: 0, total: items.length });
    let adjudicadas = 0;
    const reciboFallidos: string[] = [];
    const erroresDuros: string[] = [];
    for (const c of items) {
      const res = await fetch("/api/cobranzas/validar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          controlId: c.id,
          estado: "adjudicado",
          importeValidado: Number(c.retiro?.importe_declarado) || 0,
        }),
      });
      const etiqueta = c.retiro?.codigo_original || String(c.id).slice(0, 8).toUpperCase();
      if (!res.ok) {
        erroresDuros.push(etiqueta);
      } else {
        adjudicadas++;
        const json = await res.json().catch(() => ({}));
        if (json.recibo && json.recibo.ok === false) reciboFallidos.push(etiqueta);
      }
      setAdjudicando((prev) => (prev ? { ...prev, hecho: prev.hecho + 1 } : prev));
    }
    setAdjudicando(null);

    if (erroresDuros.length) {
      toast("warning", `${adjudicadas} adjudicada(s) ✓ · ${erroresDuros.length} no se pudieron adjudicar (${erroresDuros.slice(0, 5).join(", ")}${erroresDuros.length > 5 ? "…" : ""})`);
    } else if (reciboFallidos.length) {
      toast("warning", `${adjudicadas} adjudicada(s) ✓, pero el recibo en Interpracsys falló en ${reciboFallidos.length} (reintentalas desde su ficha: ${reciboFallidos.slice(0, 5).join(", ")}${reciboFallidos.length > 5 ? "…" : ""})`);
    } else {
      toast("success", `${adjudicadas} cobranza(s) adjudicadas ✓`);
    }
    salirDeSeleccion();
    window.dispatchEvent(new Event("badges:refresh"));
    router.refresh();
  }

  function exportar() {
    const filas = ordenados.map((c: AnyRecord) => ({
      Fecha: c.retiro?.fecha_operativa ?? "",
      Veterinaria: c.retiro?.veterinaria_texto_original ?? "",
      "Código": c.retiro?.codigo_original ?? "",
      Cadete: c.retiro?.personal?.nombre ?? "",
      "Importe declarado": c.importe_declarado ?? 0,
      "Medio de pago": c.retiro?.metodo_pago ?? "",
      Urgente: esUrgente(c) ? "Sí" : "No",
    }));
    const sufijo = [fecha, cadete && cadetes.find((c) => c.id === cadete)?.nombre].filter(Boolean).join("_") || "pendientes";
    exportToExcel(filas, `cobranzas_${sufijo}`, "Pendientes");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Búsqueda + fecha por GET → el servidor filtra sobre TODAS las pendientes. */}
        <form method="get" className="flex items-center gap-2 flex-wrap flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[200px] max-w-[340px]">
            <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gy400 text-[14px]" />
            <input type="text" name="q" defaultValue={q} placeholder="Buscar por veterinaria o código…"
              className="w-full pl-8 pr-3 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500 focus:bg-white" />
          </div>
          <input type="date" name="fecha" defaultValue={fecha}
            className="px-2.5 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500" />
          <select name="cadete" defaultValue={cadete}
            className="px-2.5 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500 max-w-[160px]">
            <option value="">Todos los cadetes</option>
            {cadetes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <button type="submit" className="px-3.5 py-1.5 bg-g800 text-white text-[12px] font-medium rounded-[8px] hover:bg-g700">Buscar</button>
          {(q || fecha || cadete) && <Link href="/cobranzas" className="px-2 py-1.5 text-[11px] text-gy500 hover:text-gy700">Limpiar</Link>}
        </form>
        <div className="flex gap-1.5 flex-wrap">
          {FILTROS.map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)}
              className={`px-3 py-1.5 rounded-full border text-[11px] transition-all ${filtro === f.id ? "bg-g800 text-white border-g800" : "bg-white text-gy600 border-gy200 hover:border-g400 hover:text-g700"}`}>
              {f.label}
            </button>
          ))}
          {controles.length > 0 && (
            <button onClick={exportar} title={hayMas ? `Solo exporta las ${controles.length} cargadas — usá "Mostrar más" para traer el resto antes de exportar` : undefined}
              className="px-3 py-1.5 rounded-full border text-[11px] transition-all bg-white text-gy600 border-gy200 hover:border-g400 hover:text-g700 flex items-center gap-1">
              <i className="ti ti-file-spreadsheet text-[13px]" /> Exportar Excel
            </button>
          )}
          {!modoSeleccion && controles.length > 0 && (
            <button onClick={() => setModoSeleccion(true)}
              className="px-3 py-1.5 rounded-full border text-[11px] transition-all bg-white text-gy600 border-gy200 hover:border-g400 hover:text-g700 flex items-center gap-1">
              <i className="ti ti-checkbox text-[13px]" /> Adjudicar varios
            </button>
          )}
        </div>
      </div>

      {modoSeleccion && (
        <div className="flex items-center gap-3 flex-wrap bg-white border-2 border-g200 rounded-[10px] px-3.5 py-2.5 shadow-sm">
          <span className="text-[12px] font-semibold text-gy700">
            {seleccionados.size} seleccionado{seleccionados.size === 1 ? "" : "s"}
          </span>
          <button type="button" onClick={seleccionarTodos} disabled={!!adjudicando}
            className="text-[11px] text-g700 underline disabled:opacity-50">Seleccionar todos ({idsVisibles.length})</button>
          <button
            onClick={adjudicarSeleccionados}
            disabled={!seleccionados.size || !!adjudicando}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-g50 text-g700 border border-g200 rounded-[6px] hover:bg-g100 disabled:opacity-50"
          >
            {adjudicando
              ? <span className="w-3 h-3 border-2 border-g300 border-t-g700 rounded-full animate-spin" />
              : <i className="ti ti-receipt text-[13px]" />}
            {adjudicando ? `Adjudicando ${adjudicando.hecho}/${adjudicando.total}…` : "Adjudicar seleccionados"}
          </button>
          <button type="button" onClick={salirDeSeleccion} disabled={!!adjudicando}
            className="ml-auto text-[11px] text-gy500 hover:text-gy800 underline disabled:opacity-50">Cancelar</button>
        </div>
      )}
      {hayMas && (
        <div className="text-[11px] text-warn600 -mt-2">
          Hay {total - controles.length} pendientes más sin cargar — tocá &quot;Mostrar más&quot; antes de exportar si los querés incluir.
        </div>
      )}

      {!controles.length && (
        <div className="py-12 text-center text-gy400">
          {q || fecha || cadete ? "Sin resultados para el filtro" : "Sin retiros pendientes de validación"}
        </div>
      )}

      {grupos
        ? grupos.map(([nombre, items]) => (
            <div key={nombre} className="space-y-3.5">
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[12px] font-semibold text-gy700">{nombre}</span>
                <span className="text-[11px] text-gy400">({items.length})</span>
                <div className="flex-1 h-px bg-gy100" />
              </div>
              {items.map((c) => (
                <div key={c.id} className="flex items-start gap-2.5">
                  {modoSeleccion && (
                    <input type="checkbox" checked={seleccionados.has(c.id)} onChange={() => toggleSeleccion(c.id)}
                      disabled={!!adjudicando}
                      className="w-4 h-4 mt-4 shrink-0 accent-g600" />
                  )}
                  <div className="flex-1 min-w-0"><ControlCard control={c} tipo="cob" /></div>
                </div>
              ))}
            </div>
          ))
        : (
            <div className="space-y-3.5">
              {ordenados.map((c: AnyRecord) => (
                <div key={c.id} className="flex items-start gap-2.5">
                  {modoSeleccion && (
                    <input type="checkbox" checked={seleccionados.has(c.id)} onChange={() => toggleSeleccion(c.id)}
                      disabled={!!adjudicando}
                      className="w-4 h-4 mt-4 shrink-0 accent-g600" />
                  )}
                  <div className="flex-1 min-w-0"><ControlCard control={c} tipo="cob" /></div>
                </div>
              ))}
            </div>
          )}

      {total > 0 && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <div className="text-[11px] text-gy400">
            Mostrando {controles.length} de {total} pendiente{total !== 1 ? "s" : ""}
          </div>
          {hayMas && (
            <Link href={masHref} scroll={false}
              className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium bg-white border border-gy200 rounded-[8px] hover:bg-gy50 hover:border-g400 text-g700">
              <i className="ti ti-chevron-down text-[14px]" /> Mostrar más ({total - controles.length} restantes)
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
