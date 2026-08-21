"use client";

import { useEffect, useMemo, useState } from "react";
import { ControlCard } from "@/components/ui/ControlCard";

const PAGINA = 30;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

type Filtro = "todos" | "urgentes" | "personal";

const FILTROS: { id: Filtro; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "urgentes", label: "Urgentes primero" },
  { id: "personal", label: "Por personal" },
];

const esUrgente = (c: AnyRecord) => c.urgente || c.retiro?.urgente;

export function CobranzasBandeja({ controles }: { controles: AnyRecord[] }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [fecha, setFecha] = useState("");
  // Cuántas tarjetas se renderizan. Renderizar cientos de tarjetas de una traba
  // el navegador; se muestran de a tandas con "Mostrar más".
  const [limite, setLimite] = useState(PAGINA);

  // Filtra por texto (cadete / veterinaria / código) y por fecha operativa.
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return controles.filter((c) => {
      const r = c.retiro ?? {};
      if (fecha && r.fecha_operativa !== fecha) return false;
      if (!q) return true;
      return [r.personal?.nombre, r.veterinaria_texto_original, r.codigo_original]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [controles, busqueda, fecha]);

  // Al cambiar el filtro/búsqueda/fecha se vuelve a la primera tanda.
  useEffect(() => { setLimite(PAGINA); }, [busqueda, fecha, filtro]);

  // Solo se renderiza hasta `limite`. El orden/agrupación se hace ANTES de
  // recortar, así "Mostrar más" trae los siguientes según el criterio elegido.
  const ordenados = useMemo(() => {
    const arr = [...filtrados];
    if (filtro === "urgentes") {
      arr.sort((a, b) => Number(esUrgente(b)) - Number(esUrgente(a)));
    } else if (filtro === "personal") {
      arr.sort((a, b) => String(a.retiro?.personal?.nombre ?? "~").localeCompare(String(b.retiro?.personal?.nombre ?? "~"), "es"));
    }
    return arr;
  }, [filtrados, filtro]);

  const visibles = useMemo(() => ordenados.slice(0, limite), [ordenados, limite]);

  // Lista plana ordenada (para "Todos" y "Urgentes primero").
  const planos = visibles;

  // Agrupación (para "Por personal") sobre lo visible.
  const grupos = useMemo(() => {
    if (filtro !== "personal") return null;
    const map = new Map<string, AnyRecord[]>();
    for (const c of visibles) {
      const k = c.retiro?.personal?.nombre ?? "Sin asignar";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    return Array.from(map.entries());
  }, [visibles, filtro]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-[360px]">
          <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gy400 text-[14px]" />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por cadete, veterinaria o código…"
            className="w-full pl-8 pr-3 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500 focus:bg-white"
          />
        </div>
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="px-2.5 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500 focus:bg-white"
        />
        {fecha && (
          <button onClick={() => setFecha("")}
            className="px-2 py-1.5 text-[11px] text-gy500 hover:text-gy700">Limpiar fecha</button>
        )}
        <div className="flex gap-1.5 flex-wrap">
          {FILTROS.map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)}
              className={`px-3 py-1.5 rounded-full border text-[11px] transition-all ${filtro === f.id ? "bg-g800 text-white border-g800" : "bg-white text-gy600 border-gy200 hover:border-g400 hover:text-g700"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {!filtrados.length && (
        <div className="py-12 text-center text-gy400">
          {busqueda.trim() || fecha ? "Sin resultados para el filtro" : "Sin retiros pendientes de validación"}
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
                <ControlCard key={c.id} control={c} tipo="cob" />
              ))}
            </div>
          ))
        : (
            <div className="space-y-3.5">
              {planos.map((c: AnyRecord) => (
                <ControlCard key={c.id} control={c} tipo="cob" />
              ))}
            </div>
          )}

      {/* Paginación: muestra cuántas se ven y permite traer más de a tandas. */}
      {filtrados.length > 0 && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <div className="text-[11px] text-gy400">
            Mostrando {Math.min(limite, filtrados.length)} de {filtrados.length} pendiente{filtrados.length !== 1 ? "s" : ""}
          </div>
          {filtrados.length > limite && (
            <button
              onClick={() => setLimite((l) => l + PAGINA)}
              className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium bg-white border border-gy200 rounded-[8px] hover:bg-gy50 hover:border-g400 text-g700">
              <i className="ti ti-chevron-down text-[14px]" /> Mostrar más ({filtrados.length - limite} restantes)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
