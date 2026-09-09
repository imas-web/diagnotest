"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/utils/dates";
import { fmtMoneySign } from "@/lib/utils/format";
import { toast } from "@/components/ui/ToastNotification";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// Recuperación para cuando se aprieta "Confirmar" por error en vez de
// "Descartar": muestra retiros viejos (fecha_operativa anterior a hoy) que
// volvieron a 'registrado' hace poco, y permite mandarlos de nuevo a
// Duplicados sospechosos para resolverlos bien. No aparece si no hay
// candidatos — no es una pantalla que se use seguido.
export function RevertirConfirmados({ candidatos }: { candidatos: AnyRecord[] }) {
  const router = useRouter();
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const [descartado, setDescartado] = useState(false);

  const idsVisibles = useMemo(() => candidatos.map((d) => d.id as string), [candidatos]);

  if (!candidatos.length || descartado) return null;

  function toggleSeleccion(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function reabrirSeleccionados() {
    const ids = Array.from(seleccionados);
    if (!ids.length) return;
    setEnviando(true);
    const res = await fetch("/api/retiros/duplicados/resolver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, accion: "reabrir" }),
    });
    const json = await res.json().catch(() => ({}));
    setEnviando(false);

    if (!res.ok) { toast("error", json.error ?? "No se pudo revertir"); return; }
    toast("success", `${json.procesados} retiro(s) vueltos a Duplicados sospechosos ✓`);
    setSeleccionados(new Set());
    window.dispatchEvent(new Event("badges:refresh"));
    router.refresh();
  }

  return (
    <div className="bg-white border-2 border-amber/50 rounded-[14px] p-4 space-y-3">
      <div className="flex items-start gap-3">
        <i className="ti ti-arrow-back-up text-[18px] text-amber-text mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-[13px] font-semibold text-gy800">¿Confirmaste alguno por error?</div>
          <div className="text-[12px] text-gy500 mt-0.5">
            Estos {candidatos.length} retiro(s) son de días anteriores a hoy y volvieron a estado normal hace poco
            — puede ser que hayas tocado &quot;Confirmar&quot; en vez de &quot;Descartar&quot;. Seleccioná los que
            correspondan y volvelos a mandar a Duplicados sospechosos.
          </div>
        </div>
        <button type="button" onClick={() => setDescartado(true)}
          className="shrink-0 text-gy400 hover:text-gy700" title="No es un error, ocultar">
          <i className="ti ti-x text-[16px]" />
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[12px] font-medium text-gy700">{seleccionados.size} seleccionado{seleccionados.size === 1 ? "" : "s"}</span>
        <button type="button" onClick={() => setSeleccionados(new Set(idsVisibles))}
          className="text-[11px] text-g700 underline">Seleccionar todos ({idsVisibles.length})</button>
        <button
          onClick={reabrirSeleccionados}
          disabled={!seleccionados.size || enviando}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-amber-bg text-amber-text border border-amber/40 rounded-[6px] hover:brightness-95 disabled:opacity-50"
        >
          {enviando
            ? <span className="w-3 h-3 border-2 border-amber/40 border-t-amber-text rounded-full animate-spin" />
            : <i className="ti ti-arrow-back-up text-[13px]" />}
          Volver a Duplicados sospechosos
        </button>
      </div>

      <div className="table-scroll">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-gy50">
              <th className="px-3 py-2 border-b border-gy200 w-8" />
              {["ID", "Personal", "Veterinaria", "Fecha operativa", "Actualizado", "Muestras", "Importe"].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {candidatos.map((r) => (
              <tr key={r.id} className="hover:bg-gy50 border-b border-gy100 last:border-0">
                <td className="px-3 py-2">
                  <input type="checkbox" checked={seleccionados.has(r.id)} onChange={() => toggleSeleccion(r.id)}
                    className="w-4 h-4 accent-amber-text" />
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-gy500 font-medium">{String(r.id).slice(0, 8).toUpperCase()}</td>
                <td className="px-3 py-2 font-medium text-gy900">{r.personal?.nombre ?? "—"}</td>
                <td className="px-3 py-2">{r.veterinaria_texto_original}</td>
                <td className="px-3 py-2 text-gy600">{formatDateTime(r.fecha_operativa)}</td>
                <td className="px-3 py-2 text-gy600">{formatDateTime(r.updated_at)}</td>
                <td className="px-3 py-2 text-center font-semibold">{r.cantidad_muestras}</td>
                <td className="px-3 py-2">{fmtMoneySign(r.importe_declarado)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
