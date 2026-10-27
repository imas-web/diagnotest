"use client";

import { useEffect, useRef, useState } from "react";
import { normVet } from "@/lib/pedidos/match";

export interface VetOption { id: string; codigo: string; nombre: string; telefono: string | null; direccion: string | null }

// Buscador que SOLO permite elegir una veterinaria del maestro — nunca deja
// un texto libre sin vincular. Antes era un <input list> con datalist: eso
// sugería, pero no impedía tipear cualquier cosa (o escribir el código donde
// iba el nombre y viceversa), y esos retiros sin veterinaria_id vinculado
// son justo los que después fallan al generar el recibo en Interpracsys
// (cobranzas necesita el código real de la vet, no el texto que haya tipeado
// el cadete). Acá, mientras no se toca un resultado de la lista, no hay
// ninguna veterinaria elegida — el formulario no puede guardar así.
export function VeterinariaPicker({
  veterinarias, selected, onSelect, textoSinVincular, placeholder = "Buscar por nombre o código…",
}: {
  veterinarias: VetOption[];
  selected: VetOption | null;
  onSelect: (v: VetOption | null) => void;
  textoSinVincular?: string;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const q = normVet(query);
  // Código exacto (ej. tipear "431" y que exista justo ese código) resuelve
  // directo, sin tener que tocar nada — igual que el buscador viejo. El resto
  // de los casos (nombre, código parcial) sigue mostrando la lista filtrada,
  // con los que EMPIEZAN con lo tipeado primero (más relevante que los que
  // solo lo contienen en el medio).
  const exacto = q.length >= 1 ? veterinarias.find((v) => normVet(v.codigo) === q) : undefined;

  // Si dejó de tipear un instante y lo que puso es un código exacto, lo
  // selecciona solo — no hace falta tocar nada ni que el Enter del teclado
  // del celular dispare bien (en mobile/PWA no siempre llega el evento). El
  // debounce (en vez de resolver en cada letra) evita elegir de más a mitad
  // de escritura cuando un código corto es prefijo de uno más largo.
  useEffect(() => {
    if (!exacto) return;
    const t = setTimeout(() => elegir(exacto), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exacto?.id]);
  const rango = (v: VetOption) => {
    if (normVet(v.codigo) === q) return 0; // código exacto primero
    if (normVet(v.codigo).startsWith(q) || normVet(v.nombre).startsWith(q)) return 1;
    return 2;
  };
  const resultados = q.length < 2 ? [] : veterinarias
    .filter((v) => normVet(v.codigo).includes(q) || normVet(v.nombre).includes(q))
    .sort((a, b) => rango(a) - rango(b))
    .slice(0, 40);

  function elegir(v: VetOption) {
    onSelect(v);
    setQuery("");
    setOpen(false);
  }

  // El match exacto de código se resuelve con Enter (como el buscador viejo),
  // no en cada letra tipeada — si se resolviera solo con tipear, un código
  // corto que sea prefijo de otro más largo (ej. existe el código "43" y el
  // cadete está tipeando "431") seleccionaría de más antes de que termine de
  // escribir.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (exacto) { elegir(exacto); return; }
    if (resultados.length === 1) elegir(resultados[0]);
  }

  return (
    <div ref={wrapRef} className="relative">
      {selected ? (
        <div className="flex items-center gap-2 px-3 py-2.5 border-2 border-g300 bg-g50 rounded-[10px]">
          <i className="ti ti-building-store text-[17px] text-g600 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[15px] font-bold text-gy900 leading-tight">{selected.codigo || "S/C"}</div>
            <div className="text-[12px] text-gy500 truncate">{selected.nombre}</div>
          </div>
          <button type="button" onClick={() => onSelect(null)}
            className="shrink-0 text-gy400 hover:text-gy700 w-7 h-7 flex items-center justify-center rounded-[6px] hover:bg-white"
            title="Cambiar veterinaria" aria-label="Cambiar veterinaria">
            <i className="ti ti-x text-[15px]" />
          </button>
        </div>
      ) : (
        <>
          {textoSinVincular && (
            <div className="flex items-start gap-1.5 mb-1.5 text-[11px] text-amber-text bg-amber-bg border border-amber/40 rounded-[8px] px-2.5 py-1.5">
              <i className="ti ti-alert-triangle text-[13px] mt-0.5 shrink-0" />
              <span>Esta carga tenía &quot;{textoSinVincular}&quot; sin vincular al maestro — buscá y elegí la veterinaria real para poder guardar.</span>
            </div>
          )}
          <input
            type="text" value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="w-full px-3.5 py-2.5 border-2 border-gy200 rounded-[10px] text-[15px] bg-gy50 focus:outline-none focus:border-g500"
          />
        </>
      )}
      {open && !selected && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white border-2 border-gy200 rounded-[10px] shadow-lg">
          {q.length < 2 ? (
            <div className="px-3.5 py-3 text-[12px] text-gy400">Escribí al menos 2 letras para buscar…</div>
          ) : resultados.length === 0 ? (
            <div className="px-3.5 py-3 text-[12px] text-gy400">No encontramos ninguna veterinaria. Avisá a logística si falta cargarla.</div>
          ) : (
            resultados.map((v) => (
              <button key={v.id} type="button" onClick={() => elegir(v)}
                className="w-full text-left px-3.5 py-2.5 hover:bg-g50 border-b border-gy100 last:border-0">
                <div className="font-mono text-[13px] font-bold text-gy900">{v.codigo || "S/C"}</div>
                <div className="text-[12px] text-gy500 truncate">{v.nombre}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
