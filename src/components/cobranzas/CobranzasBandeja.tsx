"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ControlCard } from "@/components/ui/ControlCard";

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
  controles, total, q, fecha, ver,
}: {
  controles: AnyRecord[]; total: number; q: string; fecha: string; ver: number;
}) {
  const [filtro, setFiltro] = useState<Filtro>("todos");

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
  const masHref = { pathname: "/cobranzas", query: { ...(q ? { q } : {}), ...(fecha ? { fecha } : {}), ver: ver + 50 } };

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
          <button type="submit" className="px-3.5 py-1.5 bg-g800 text-white text-[12px] font-medium rounded-[8px] hover:bg-g700">Buscar</button>
          {(q || fecha) && <Link href="/cobranzas" className="px-2 py-1.5 text-[11px] text-gy500 hover:text-gy700">Limpiar</Link>}
        </form>
        <div className="flex gap-1.5 flex-wrap">
          {FILTROS.map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)}
              className={`px-3 py-1.5 rounded-full border text-[11px] transition-all ${filtro === f.id ? "bg-g800 text-white border-g800" : "bg-white text-gy600 border-gy200 hover:border-g400 hover:text-g700"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {!controles.length && (
        <div className="py-12 text-center text-gy400">
          {q || fecha ? "Sin resultados para el filtro" : "Sin retiros pendientes de validación"}
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
              {items.map((c) => <ControlCard key={c.id} control={c} tipo="cob" />)}
            </div>
          ))
        : (
            <div className="space-y-3.5">
              {ordenados.map((c: AnyRecord) => <ControlCard key={c.id} control={c} tipo="cob" />)}
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
