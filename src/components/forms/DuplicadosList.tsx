"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/utils/dates";
import { fmtMoneySign } from "@/lib/utils/format";
import { DuplicadoActions } from "@/components/forms/DuplicadoActions";
import { toast } from "@/components/ui/ToastNotification";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// Tabla de Duplicados con selección múltiple: permite Confirmar o Descartar
// varios retiros de una, en vez de tocar "Confirmar"/"Descartar" fila por fila.
// Disponible para todos los roles que ven esta pantalla (preanalítica,
// logística, dueño, super_admin) — a diferencia del marcado en lote de
// Observados, acá cada fila ya fue individualmente marcada como sospechosa
// por el detector o por preanalítica; resolverla en lote no oculta revisión,
// solo evita repetir el mismo click.
export function DuplicadosList({ duplicados }: { duplicados: AnyRecord[] }) {
  const router = useRouter();
  const [modoSeleccion, setModoSeleccion] = useState(false);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [resolviendoLote, setResolviendoLote] = useState<"confirmar" | "anular" | null>(null);

  const idsVisibles = useMemo(() => duplicados.map((d) => d.id as string), [duplicados]);

  function toggleSeleccion(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function seleccionarTodos() {
    setSeleccionados(new Set(idsVisibles));
  }

  function salirDeSeleccion() {
    setModoSeleccion(false);
    setSeleccionados(new Set());
  }

  async function resolverSeleccionados(accion: "confirmar" | "anular") {
    const ids = Array.from(seleccionados);
    if (!ids.length) return;
    if (accion === "anular" && !window.confirm(`¿Descartar estos ${ids.length} retiro(s) por ser duplicados?\n\nNo se eliminan: quedan anulados (no suman a las muestras ni a los totales) y salen de las bandejas, pero los registros se conservan.`)) return;

    setResolviendoLote(accion);
    const res = await fetch("/api/retiros/duplicados/resolver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, accion }),
    });
    const json = await res.json().catch(() => ({}));
    setResolviendoLote(null);

    if (!res.ok) { toast("error", json.error ?? "No se pudo resolver el lote"); return; }
    const fallidos = json.errores?.length ?? 0;
    const verbo = accion === "confirmar" ? "confirmado(s)" : "descartado(s)";
    if (fallidos) {
      toast("warning", `${json.procesados} ${verbo} ✓ · ${fallidos} no se pudieron resolver`);
    } else {
      toast(accion === "confirmar" ? "success" : "warning", `${json.procesados} ${verbo} ✓`);
    }
    salirDeSeleccion();
    window.dispatchEvent(new Event("badges:refresh"));
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        {!modoSeleccion && duplicados.length > 0 && (
          <button type="button" onClick={() => setModoSeleccion(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-white text-gy600 border-2 border-gy200 rounded-[8px] hover:border-g400 hover:text-g700">
            <i className="ti ti-checkbox text-[14px]" /> Seleccionar varios
          </button>
        )}
      </div>

      {modoSeleccion && (
        <div className="flex items-center gap-3 flex-wrap bg-white border-2 border-g200 rounded-[10px] px-3.5 py-2.5 shadow-sm">
          <span className="text-[12px] font-semibold text-gy700">
            {seleccionados.size} seleccionado{seleccionados.size === 1 ? "" : "s"}
          </span>
          <button type="button" onClick={seleccionarTodos}
            className="text-[11px] text-g700 underline">Seleccionar todos ({idsVisibles.length})</button>
          <button
            onClick={() => resolverSeleccionados("confirmar")}
            disabled={!seleccionados.size || resolviendoLote !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-g50 text-g700 border border-g200 rounded-[6px] hover:bg-g100 disabled:opacity-50"
          >
            {resolviendoLote === "confirmar"
              ? <span className="w-3 h-3 border-2 border-g300 border-t-g700 rounded-full animate-spin" />
              : <i className="ti ti-check text-[13px]" />}
            Confirmar seleccionados
          </button>
          <button
            onClick={() => resolverSeleccionados("anular")}
            disabled={!seleccionados.size || resolviendoLote !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-red-50 text-red-700 border border-red-200 rounded-[6px] hover:bg-red-100 disabled:opacity-50"
          >
            {resolviendoLote === "anular"
              ? <span className="w-3 h-3 border-2 border-red-300 border-t-red-700 rounded-full animate-spin" />
              : <i className="ti ti-x text-[13px]" />}
            Descartar seleccionados
          </button>
          <button type="button" onClick={salirDeSeleccion} disabled={resolviendoLote !== null}
            className="ml-auto text-[11px] text-gy500 hover:text-gy800 underline disabled:opacity-50">Cancelar</button>
        </div>
      )}

      <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
        <div className="table-scroll">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-gy50">
                {modoSeleccion && <th className="px-3.5 py-2.5 border-b border-gy200 w-8" />}
                {["ID", "Personal", "Veterinaria", "Fecha/hora", "Muestras", "Importe", "Posible dup. de", "Acciones"].map((h) => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {duplicados.map((r) => (
                <tr key={r.id} className="hover:bg-gy50 border-b border-gy100 last:border-0">
                  {modoSeleccion && (
                    <td className="px-3.5 py-2.5">
                      <input type="checkbox" checked={seleccionados.has(r.id)} onChange={() => toggleSeleccion(r.id)}
                        className="w-4 h-4 accent-g700" />
                    </td>
                  )}
                  <td className="px-3.5 py-2.5 font-mono text-[11px] text-red-500 font-medium">{String(r.id).slice(0, 8).toUpperCase()}</td>
                  <td className="px-3.5 py-2.5 font-medium text-gy900">{r.personal?.nombre ?? "—"}</td>
                  <td className="px-3.5 py-2.5">{r.veterinaria_texto_original}</td>
                  <td className="px-3.5 py-2.5 text-gy600">{formatDateTime(r.timestamp_carga)}</td>
                  <td className="px-3.5 py-2.5 text-center font-semibold">{r.cantidad_muestras}</td>
                  <td className="px-3.5 py-2.5">{fmtMoneySign(r.importe_declarado)}</td>
                  <td className="px-3.5 py-2.5 font-mono text-[11px] text-red-500">—</td>
                  <td className="px-3.5 py-2.5">
                    <DuplicadoActions retiroId={r.id} />
                  </td>
                </tr>
              ))}
              {!duplicados.length && (
                <tr><td colSpan={modoSeleccion ? 9 : 8} className="py-10 text-center text-gy400">Sin duplicados detectados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
