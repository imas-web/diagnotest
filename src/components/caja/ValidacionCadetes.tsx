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
  const [validandoMasivo, setValidandoMasivo] = useState(false);

  const filtradas = useMemo(
    () => (soloPendientes ? cajas.filter((c) => !c.validado) : cajas),
    [cajas, soloPendientes]
  );
  const pendientesCount = useMemo(() => cajas.filter((c) => !c.validado).length, [cajas]);

  async function validarTodasMasivo() {
    const ok = window.confirm(
      `Vas a marcar como "OK, coincide" las ${pendientesCount} caja(s) pendientes hasta hoy, ` +
      "como si cada cadete hubiera validado su efectivo. Usalo solo para arrancar en limpio antes " +
      "de que empiecen a validar ellos mismos. ¿Confirmás?"
    );
    if (!ok) return;
    setValidandoMasivo(true);
    const res = await fetch("/api/caja/validaciones/masivo", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setValidandoMasivo(false);
    if (!res.ok) { toast("error", json.error ?? "No se pudo validar en forma masiva"); return; }
    toast("success", `${json.marcadas} caja(s) marcadas como validadas ✓`);
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
        {puedeValidarMasivo && pendientesCount > 0 && (
          <button type="button" onClick={validarTodasMasivo} disabled={validandoMasivo}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-[11px] font-semibold rounded-[8px] hover:bg-blue-700 disabled:opacity-50">
            {validandoMasivo
              ? <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <i className="ti ti-checks text-[13px]" />}
            Marcar todas como validadas
          </button>
        )}
      </div>

      <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
        {!filtradas.length ? (
          <div className="py-12 text-center text-gy400">
            {cajas.length === 0 ? "No hay cajas abiertas todavía" : "Todos los cadetes con caja abierta ya validaron ✓"}
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-gy50 text-[10px] uppercase tracking-wide text-gy400 font-semibold">
                <th className="px-4 py-2 text-left">Cadete</th>
                <th className="px-4 py-2 text-left">Día</th>
                <th className="px-4 py-2 text-right">Retiros</th>
                <th className="px-4 py-2 text-left">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => (
                <tr key={`${c.personalId}|${c.fecha}`} className="border-b border-gy100 last:border-0">
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
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
