"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ControlCard } from "@/components/ui/ControlCard";
import { toast } from "@/components/ui/ToastNotification";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// Lista de Observados con buscador por cadete y por veterinaria/código/etiqueta.
// Los dos filtros son acumulativos (se combinan) y filtran en vivo; el texto
// queda siempre visible para no "perder" un filtro al usar el otro.
//
// La selección múltiple (marcar varios como duplicado de una) queda reservada
// a super_admin: es fácil de usar mal (marca muchos retiros de golpe) y este
// listado también lo usa preanalítica en el día a día, de a un registro.
export function ObservadosList({ controles, esSuperAdmin }: { controles: AnyRecord[]; esSuperAdmin: boolean }) {
  const router = useRouter();
  const [qCadete, setQCadete] = useState("");
  const [qVete, setQVete] = useState("");
  const [modoSeleccion, setModoSeleccion] = useState(false);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [marcandoLote, setMarcandoLote] = useState(false);

  const filtrados = useMemo(() => {
    const qc = qCadete.trim().toLowerCase();
    const qv = qVete.trim().toLowerCase();
    if (!qc && !qv) return controles;
    return controles.filter((c) => {
      const r = c.retiro ?? {};
      const okCadete = !qc || String(r.personal?.nombre ?? "").toLowerCase().includes(qc);
      const etiquetas = Array.isArray(c.etiquetas) ? c.etiquetas : [];
      const okVete = !qv || [r.veterinaria_texto_original, r.codigo_original, ...etiquetas]
        .some((v: unknown) => String(v ?? "").toLowerCase().includes(qv));
      return okCadete && okVete;
    });
  }, [controles, qCadete, qVete]);

  function toggleSeleccion(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function seleccionarTodosVisibles() {
    setSeleccionados(new Set(filtrados.map((c) => c.id)));
  }

  function salirDeSeleccion() {
    setModoSeleccion(false);
    setSeleccionados(new Set());
  }

  async function marcarSeleccionadosComoDuplicado() {
    const ids = Array.from(seleccionados);
    if (!ids.length) return;
    if (!window.confirm(`¿Marcar ${ids.length} registro(s) como duplicado?\n\nPasan a Retiros → Duplicados, donde se pueden confirmar o anular de a uno. Salen de Observados.`)) return;

    setMarcandoLote(true);
    const res = await fetch("/api/preanalitica/marcar-duplicado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ controlIds: ids }),
    });
    const json = await res.json().catch(() => ({}));
    setMarcandoLote(false);

    if (!res.ok) { toast("error", json.error ?? "No se pudo marcar el lote"); return; }
    const fallidos = json.errores?.length ?? 0;
    if (fallidos) {
      toast("warning", `${json.procesados} marcado(s) ✓ · ${fallidos} no se pudieron marcar`);
    } else {
      toast("success", `${json.procesados} marcado(s) como duplicado ✓`);
    }
    salirDeSeleccion();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[170px] max-w-[260px]">
          <i className="ti ti-user absolute left-3 top-1/2 -translate-y-1/2 text-gy400 text-[14px]" />
          <input
            type="text"
            value={qCadete}
            onChange={(e) => setQCadete(e.target.value)}
            placeholder="Filtrar por cadete…"
            className="w-full pl-8 pr-8 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500 focus:bg-white"
          />
          {qCadete && (
            <button type="button" onClick={() => setQCadete("")} title="Limpiar"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gy400 hover:text-gy700">
              <i className="ti ti-x text-[13px]" />
            </button>
          )}
        </div>
        <div className="relative flex-1 min-w-[170px] max-w-[260px]">
          <i className="ti ti-building-store absolute left-3 top-1/2 -translate-y-1/2 text-gy400 text-[14px]" />
          <input
            type="text"
            value={qVete}
            onChange={(e) => setQVete(e.target.value)}
            placeholder="Veterinaria, código o etiqueta…"
            className="w-full pl-8 pr-8 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500 focus:bg-white"
          />
          {qVete && (
            <button type="button" onClick={() => setQVete("")} title="Limpiar"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gy400 hover:text-gy700">
              <i className="ti ti-x text-[13px]" />
            </button>
          )}
        </div>

        {esSuperAdmin && !modoSeleccion && (
          <button type="button" onClick={() => setModoSeleccion(true)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-white text-gy600 border-2 border-gy200 rounded-[8px] hover:border-g400 hover:text-g700">
            <i className="ti ti-checkbox text-[14px]" /> Seleccionar varios
          </button>
        )}
      </div>

      {(qCadete.trim() || qVete.trim()) && (
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          <span className="text-gy400">Filtrando</span>
          {qCadete.trim() && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-g50 text-g700 border border-g700/30">
              <i className="ti ti-user text-[11px]" />{qCadete.trim()}
            </span>
          )}
          {qCadete.trim() && qVete.trim() && <span className="text-gy400">+</span>}
          {qVete.trim() && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-g50 text-g700 border border-g700/30">
              <i className="ti ti-building-store text-[11px]" />{qVete.trim()}
            </span>
          )}
          <button onClick={() => { setQCadete(""); setQVete(""); }}
            className="ml-1 text-gy500 hover:text-gy800 underline">Limpiar todo</button>
        </div>
      )}

      {modoSeleccion && (
        <div className="sticky top-0 z-10 flex items-center gap-3 flex-wrap bg-white border-2 border-g200 rounded-[10px] px-3.5 py-2.5 shadow-sm">
          <span className="text-[12px] font-semibold text-gy700">
            {seleccionados.size} seleccionado{seleccionados.size === 1 ? "" : "s"}
          </span>
          <button type="button" onClick={seleccionarTodosVisibles}
            className="text-[11px] text-g700 underline">Seleccionar todos ({filtrados.length})</button>
          <button
            onClick={marcarSeleccionadosComoDuplicado}
            disabled={!seleccionados.size || marcandoLote}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-red-50 text-red-700 border border-red-200 rounded-[6px] hover:bg-red-100 disabled:opacity-50"
          >
            {marcandoLote
              ? <span className="w-3 h-3 border-2 border-red-300 border-t-red-700 rounded-full animate-spin" />
              : <i className="ti ti-copy-off text-[13px]" />}
            Marcar como duplicado
          </button>
          <button type="button" onClick={salirDeSeleccion} disabled={marcandoLote}
            className="ml-auto text-[11px] text-gy500 hover:text-gy800 underline disabled:opacity-50">Cancelar</button>
        </div>
      )}

      {!filtrados.length ? (
        <div className="bg-white rounded-[14px] border border-gy200 shadow-sm py-12 text-center text-gy400 text-[13px]">
          {qCadete.trim() || qVete.trim() ? "Sin resultados para la búsqueda" : "Sin registros observados"}
        </div>
      ) : (
        <div className="space-y-3.5">
          {filtrados.map((c) => (
            <div key={c.id} className={modoSeleccion ? "flex items-start gap-2.5" : undefined}>
              {modoSeleccion && (
                <input
                  type="checkbox"
                  checked={seleccionados.has(c.id)}
                  onChange={() => toggleSeleccion(c.id)}
                  className="mt-4 w-4 h-4 shrink-0 accent-g700"
                />
              )}
              <div className="flex-1 min-w-0">
                <ControlCard control={c} tipo="pre" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
