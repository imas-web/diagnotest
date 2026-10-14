"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/ToastNotification";

export type CajaValidacion = {
  personalId: string;
  nombre: string;
  fecha: string;
  retiros: number;
  validado: boolean;
};

const fmtDia = (f: string) => {
  const [y, m, d] = f.split("-");
  return `${d}/${m}/${y.slice(2)}`;
};

// Lista de "¿ya validó su efectivo?" por cadete y día — para que Dirección
// vea de un vistazo a quién le falta insistir. "Validar" acá es que el
// cadete haya cargado un gasto tipo "diferencia de caja" (Me falta / Me
// sobra / OK, coincide) para esa jornada, desde su propio Resumen.
export function ValidacionCadetes({ cajas, puedeValidarMasivo }: { cajas: CajaValidacion[]; puedeValidarMasivo?: boolean }) {
  const router = useRouter();
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [validando, setValidando] = useState(false);

  const filtradas = useMemo(
    () => (soloPendientes ? cajas.filter((c) => !c.validado) : cajas),
    [cajas, soloPendientes]
  );

  // Solo las sin validar se pueden seleccionar/tildar.
  const seleccionablesVisibles = useMemo(() => filtradas.filter((c) => !c.validado), [filtradas]);
  const todasSeleccionadas = seleccionablesVisibles.length > 0
    && seleccionablesVisibles.every((c) => seleccionadas.has(`${c.personalId}|${c.fecha}`));

  function toggleFila(key: string) {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleTodas() {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (todasSeleccionadas) seleccionablesVisibles.forEach((c) => next.delete(`${c.personalId}|${c.fecha}`));
      else seleccionablesVisibles.forEach((c) => next.add(`${c.personalId}|${c.fecha}`));
      return next;
    });
  }

  async function validarSeleccionadas() {
    const items = Array.from(seleccionadas).map((key) => {
      const [personalId, fecha] = key.split("|");
      return { personalId, fecha };
    });
    if (!items.length) return;
    const ok = window.confirm(
      `Vas a marcar como "OK, coincide" ${items.length} caja(s) seleccionada(s), ` +
      "como si cada cadete hubiera validado su efectivo. ¿Confirmás?"
    );
    if (!ok) return;
    setValidando(true);
    const res = await fetch("/api/caja/validaciones/masivo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const json = await res.json().catch(() => ({}));
    setValidando(false);
    if (!res.ok) { toast("error", json.error ?? "No se pudo validar"); return; }
    toast("success", `${json.marcadas} caja(s) marcadas como validadas ✓`);
    setSeleccionadas(new Set());
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[12px] text-gy600 cursor-pointer py-1.5">
          <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} className="accent-red-600" />
          Solo sin validar
        </label>
        <span className="text-[11px] text-gy400">{filtradas.length} de {cajas.length}</span>
      </div>

      {puedeValidarMasivo && seleccionadas.size > 0 && (
        <div className="flex items-center gap-2 bg-amber-bg border border-amber/40 rounded-[10px] px-3.5 py-2.5">
          <span className="text-[12px] font-semibold text-amber-text">{seleccionadas.size} seleccionada{seleccionadas.size !== 1 ? "s" : ""}</span>
          <button type="button" onClick={validarSeleccionadas} disabled={validando}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-[12px] font-semibold rounded-[8px] hover:bg-blue-700 disabled:opacity-50">
            {validando
              ? <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <i className="ti ti-checks text-[13px]" />}
            Marcar validadas
          </button>
          <button type="button" onClick={() => setSeleccionadas(new Set())} disabled={validando}
            className="px-2.5 py-1.5 text-[12px] font-medium text-gy600 hover:text-gy900">
            Cancelar
          </button>
        </div>
      )}

      <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
        {!filtradas.length ? (
          <div className="py-12 text-center text-gy400">
            {cajas.length === 0 ? "No hay cajas abiertas todavía" : "Todos los cadetes con caja abierta ya validaron ✓"}
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-gy50 text-[10px] uppercase tracking-wide text-gy400 font-semibold">
                <th className="px-4 py-2 w-8">
                  {puedeValidarMasivo && seleccionablesVisibles.length > 0 && (
                    <input type="checkbox" checked={todasSeleccionadas} onChange={toggleTodas}
                      title="Seleccionar todas las sin validar visibles" className="accent-red-600" />
                  )}
                </th>
                <th className="px-4 py-2 text-left">Cadete</th>
                <th className="px-4 py-2 text-left">Día</th>
                <th className="px-4 py-2 text-right">Retiros</th>
                <th className="px-4 py-2 text-left">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => {
                const key = `${c.personalId}|${c.fecha}`;
                return (
                  <tr key={key} className="border-b border-gy100 last:border-0">
                    <td className="px-4 py-2">
                      {puedeValidarMasivo && !c.validado && (
                        <input type="checkbox" checked={seleccionadas.has(key)} onChange={() => toggleFila(key)} className="accent-red-600" />
                      )}
                    </td>
                    <td className="px-4 py-2 font-medium text-gy900">{c.nombre}</td>
                    <td className="px-4 py-2 text-gy600 whitespace-nowrap">{fmtDia(c.fecha)}</td>
                    <td className="px-4 py-2 text-right text-gy700">{c.retiros}</td>
                    <td className="px-4 py-2">
                      {c.validado ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-g700 bg-g50 border border-g200 rounded-full px-2 py-0.5">
                          <i className="ti ti-check" /> Validó
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                          <i className="ti ti-alert-triangle" /> No validó — insistirle
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
