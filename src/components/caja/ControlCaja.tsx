"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/ToastNotification";
import { fmtMoneySign } from "@/lib/utils/format";

export interface RendicionCadete {
  personalId: string;
  nombre: string;
  fecha: string;
  totalEfectivo: number;
  totalDigital: number;
  totalRecaudado: number;
  retirosEfectivo: number;
  retirosDigital: number;
  gastos: { descripcion: string; monto: number; tipo: string }[];
  totalGastos: number;
  efectivoEsperado: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rendicion: any | null;
}

export interface RevisadoRow {
  id: string;
  nombre: string;
  fecha: string;
  totalRecaudado: number;
  totalEfectivo: number;
  totalDigital: number;
  totalGastos: number;
  efectivoEsperado: number;
  importeValidado: number;
  diferencia: number;
  estado: string;
  observacion: string | null;
  resuelta: boolean;
  resuelvePor: string | null;
  notaResolucion: string | null;
}

type Tab = "pendientes" | "revisado";

export function ControlCaja({ fecha, items, revisados }: { fecha: string; items: RendicionCadete[]; revisados: RevisadoRow[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pendientes");

  // Pendientes de revisión: cadetes de la fecha sin rendición validada.
  const pendientes = items.filter((i) => !i.rendicion || i.rendicion.estado === "pendiente");

  const totalEsperado = pendientes.reduce((s, i) => s + i.efectivoEsperado, 0);
  const totalRecaudado = pendientes.reduce((s, i) => s + i.totalRecaudado, 0);
  const totalGastos = pendientes.reduce((s, i) => s + i.totalGastos, 0);

  return (
    <div className="space-y-4">
      {/* Selector de fecha + resumen del día (aplica a pendientes de la fecha) */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gy400">Fecha</label>
          <input type="date" defaultValue={fecha}
            onChange={(e) => router.push(`/caja?fecha=${e.target.value}`)}
            className="px-2.5 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500" />
        </div>
        <div className="ml-auto flex items-center gap-4 text-[12px]">
          <span className="text-gy500">Recaudado: <b className="text-gy800">{fmtMoneySign(totalRecaudado)}</b></span>
          <span className="text-gy500">Gastos: <b className="text-gy800">{fmtMoneySign(totalGastos)}</b></span>
          <span className="text-gy500">Efectivo esperado: <b className="text-g700">{fmtMoneySign(totalEsperado)}</b></span>
        </div>
      </div>

      {/* Solapas */}
      <div className="flex gap-1 border-b border-gy200">
        {([["pendientes", "Pendientes de revisión", pendientes.length], ["revisado", "Revisado", revisados.length]] as [Tab, string, number][]).map(([id, label, count]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${tab === id ? "border-g700 text-g700" : "border-transparent text-gy500 hover:text-gy700"}`}>
            {label}
            <span className={`ml-1.5 text-[10px] font-bold rounded-full px-1.5 py-0.5 ${tab === id ? "bg-g50 text-g700" : "bg-gy100 text-gy500"}`}>{count}</span>
          </button>
        ))}
      </div>

      {/* Contenido */}
      {tab === "pendientes" ? (
        <div className="space-y-4">
          {pendientes.length === 0 ? (
            <div className="py-12 text-center text-gy400">No hay rendiciones pendientes de revisión en esta fecha</div>
          ) : (
            pendientes.map((it) => (
              <CadeteCard key={it.personalId + "|" + it.fecha} item={it} onSaved={() => router.refresh()} />
            ))
          )}
        </div>
      ) : (
        <RevisadoTabla rows={revisados} />
      )}
    </div>
  );
}

function RevisadoTabla({ rows }: { rows: RevisadoRow[] }) {
  const fmtDia = (f: string) => {
    const [y, m, d] = f.split("-");
    return `${d}/${m}/${y.slice(2)}`;
  };

  const [cadete, setCadete] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  // Por defecto, esta tabla arranca mostrando justo lo que hay que resolver:
  // solo diferencias, sin las que ya se marcaron como resueltas. Un par de
  // checks la vuelven a abrir a todo el historial (validados + resueltas).
  const [soloDif, setSoloDif] = useState(true);
  const [ocultarResueltas, setOcultarResueltas] = useState(true);

  // Cadetes únicos para el desplegable.
  const cadetes = Array.from(new Set(rows.map((r) => r.nombre))).sort((a, b) => a.localeCompare(b, "es"));

  const filtradas = rows.filter((r) => {
    if (cadete && r.nombre !== cadete) return false;
    if (desde && r.fecha < desde) return false;
    if (hasta && r.fecha > hasta) return false;
    if (soloDif && r.estado !== "diferencia") return false;
    if (ocultarResueltas && r.estado === "diferencia" && r.resuelta) return false;
    return true;
  });

  const sumDif = filtradas.reduce((s, r) => s + r.diferencia, 0);
  const sumEsperado = filtradas.reduce((s, r) => s + r.efectivoEsperado, 0);
  const sumRecibido = filtradas.reduce((s, r) => s + r.importeValidado, 0);
  const hayFiltro = cadete || desde || hasta || !soloDif || !ocultarResueltas;

  const inputCls = "px-2.5 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500";

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="flex items-end gap-3 flex-wrap bg-white rounded-[12px] border border-gy200 shadow-sm px-3.5 py-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-gy400">Cadete</label>
          <select value={cadete} onChange={(e) => setCadete(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            {cadetes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-gy400">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-gy400">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} />
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-gy600 cursor-pointer py-1.5">
          <input type="checkbox" checked={soloDif} onChange={(e) => setSoloDif(e.target.checked)} className="accent-red-600" />
          Solo con diferencia
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-gy600 cursor-pointer py-1.5">
          <input type="checkbox" checked={ocultarResueltas} onChange={(e) => setOcultarResueltas(e.target.checked)} className="accent-red-600" />
          Ocultar resueltas
        </label>
        {hayFiltro && (
          <button onClick={() => { setCadete(""); setDesde(""); setHasta(""); setSoloDif(true); setOcultarResueltas(true); }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium text-gy600 hover:text-gy900">
            <i className="ti ti-x text-[13px]" /> Limpiar
          </button>
        )}
        <div className="ml-auto text-[11px] text-gy400 py-1.5">{filtradas.length} de {rows.length}</div>
      </div>

      <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
      <div className="table-scroll">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-gy50">
              {["Cadete", "Día", "Recaudado", "Ingresos efectivo", "Gastos", "Efectivo esperado", "Efectivo recibido", "Diferencia", "Estado", "Acción"].map((h) => (
                <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtradas.map((r) => {
              const conDif = r.estado === "diferencia";
              return (
                <tr key={r.id} className="hover:bg-gy50 border-b border-gy100 last:border-0">
                  <td className="px-3.5 py-2.5 font-medium text-gy900">{r.nombre}</td>
                  <td className="px-3.5 py-2.5 text-gy600 whitespace-nowrap">{fmtDia(r.fecha)}</td>
                  <td className="px-3.5 py-2.5">{fmtMoneySign(r.totalRecaudado)}</td>
                  <td className="px-3.5 py-2.5">{fmtMoneySign(r.totalEfectivo)}</td>
                  <td className="px-3.5 py-2.5">{fmtMoneySign(r.totalGastos)}</td>
                  <td className="px-3.5 py-2.5 font-semibold text-g700">{fmtMoneySign(r.efectivoEsperado)}</td>
                  <td className="px-3.5 py-2.5">{fmtMoneySign(r.importeValidado)}</td>
                  <td className={`px-3.5 py-2.5 font-bold ${r.diferencia < 0 ? "text-red-600" : r.diferencia > 0 ? "text-amber-text" : "text-g700"}`}>
                    {r.diferencia >= 0 ? "+" : ""}{fmtMoneySign(r.diferencia)}
                  </td>
                  <td className="px-3.5 py-2.5">
                    {conDif ? (
                      r.resuelta ? (
                        <span title={r.notaResolucion ? `Nota: ${r.notaResolucion}` : undefined}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-gy600 bg-gy100 border border-gy200 rounded-full px-2 py-0.5">
                          <i className="ti ti-check" /> Diferencia resuelta
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                          <i className="ti ti-alert-triangle" /> Diferencia
                        </span>
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-g700 bg-g50 border border-g200 rounded-full px-2 py-0.5">
                        <i className="ti ti-check" /> Validado
                      </span>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5">
                    {conDif && <ResolverDiferencia row={r} />}
                  </td>
                </tr>
              );
            })}
            {filtradas.length === 0 && (
              <tr><td colSpan={10} className="py-10 text-center text-gy400">
                {rows.length === 0 ? "Todavía no hay rendiciones revisadas" : "Ningún registro coincide con los filtros"}
              </td></tr>
            )}
          </tbody>
          {filtradas.length > 0 && (
            <tfoot>
              <tr className="bg-gy50 border-t-2 border-gy200 font-bold text-gy800">
                <td className="px-3.5 py-2.5" colSpan={5}>Totales ({filtradas.length})</td>
                <td className="px-3.5 py-2.5 text-g700">{fmtMoneySign(sumEsperado)}</td>
                <td className="px-3.5 py-2.5">{fmtMoneySign(sumRecibido)}</td>
                <td className={`px-3.5 py-2.5 ${sumDif < 0 ? "text-red-600" : sumDif > 0 ? "text-amber-text" : "text-g700"}`}>
                  {sumDif >= 0 ? "+" : ""}{fmtMoneySign(sumDif)}
                </td>
                <td className="px-3.5 py-2.5" colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      </div>
    </div>
  );
}

function CadeteCard({ item, onSaved }: { item: RendicionCadete; onSaved: () => void }) {
  const r = item.rendicion;
  const [modo, setModo] = useState<"none" | "diferencia">("none");
  const [recibido, setRecibido] = useState("");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);

  async function enviar(estado: "validado" | "diferencia") {
    if (estado === "diferencia" && recibido.trim() === "") {
      toast("error", "Ingresá el efectivo recibido"); return;
    }
    setSaving(true);
    const res = await fetch("/api/caja/validar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personalId: item.personalId,
        fecha: item.fecha,
        estado,
        importeValidado: estado === "diferencia" ? parseFloat(recibido) : undefined,
        observacion: obs || undefined,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { toast("error", json.error ?? "Error al validar"); return; }
    toast("success", estado === "validado" ? "Rendición validada ✓" : "Diferencia registrada");
    setModo("none"); setRecibido(""); setObs("");
    onSaved();
  }

  const yaValidado = r?.estado === "validado";
  const yaDiferencia = r?.estado === "diferencia";
  const dif = Number(r?.diferencia ?? 0);

  const fmtDiaCorto = (f: string) => { const [, m, d] = f.split("-"); return `${d}/${m}`; };

  return (
    <div className={`bg-white rounded-[14px] border shadow-sm overflow-hidden ${yaDiferencia ? "border-l-4 border-l-red-500 border-gy200" : yaValidado ? "border-l-4 border-l-g500 border-gy200" : "border-gy200"}`}>
      {/* Header */}
      <div className="px-4 py-3 bg-gy50 border-b border-gy100 flex items-center gap-2.5 flex-wrap">
        <span className="text-[14px] font-semibold text-gy900">{item.nombre}</span>
        {yaValidado && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-g700 bg-g50 border border-g200 rounded-full px-2 py-0.5">
            <i className="ti ti-check" /> Validado
          </span>
        )}
        {yaDiferencia && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
            <i className="ti ti-alert-triangle" /> Diferencia {dif >= 0 ? "+" : ""}{fmtMoneySign(dif)}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gy600 bg-white border border-gy200 rounded-full px-2 py-0.5">
          <i className="ti ti-calendar text-[12px] text-gy400" /> {fmtDiaCorto(item.fecha)}
        </span>
        <span className="ml-auto text-[11px] text-gy400">
          {item.retirosEfectivo + item.retirosDigital} retiro{item.retirosEfectivo + item.retirosDigital !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Metric label="Recaudado total" value={fmtMoneySign(item.totalRecaudado)} sub={`${fmtMoneySign(item.totalEfectivo)} efvo · ${fmtMoneySign(item.totalDigital)} digital`} />
          <Metric label="Gastos declarados" value={fmtMoneySign(item.totalGastos)} sub={`${item.gastos.length} ítem${item.gastos.length !== 1 ? "s" : ""}`} />
          <Metric label="Efectivo esperado" value={fmtMoneySign(item.efectivoEsperado)} accent />
          {(yaValidado || yaDiferencia) ? (
            <Metric label="Efectivo recibido" value={fmtMoneySign(Number(r?.importe_validado ?? 0))}
              sub={yaDiferencia ? `dif ${dif >= 0 ? "+" : ""}${fmtMoneySign(dif)}` : "coincide"}
              danger={yaDiferencia} />
          ) : (
            <Metric label="Efectivo recibido" value="—" sub="pendiente de validar" />
          )}
        </div>

        {/* Detalle de gastos */}
        {item.gastos.length > 0 && (
          <div className="mb-4 rounded-[8px] border border-gy200 bg-gy50 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gy500 mb-1.5">Gastos del recorrido</div>
            <div className="flex flex-wrap gap-1.5">
              {item.gastos.map((g, i) => (
                <span key={i} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border ${g.tipo === "diferencia_caja" ? "bg-amber-bg border-amber/40 text-amber-text" : "bg-white border-gy200 text-gy700"}`}>
                  {g.tipo === "retiro_dinero" && <i className="ti ti-cash text-[12px] text-purple-500" />}
                  {g.tipo === "diferencia_caja" && <i className="ti ti-scale text-[12px]" />}
                  {g.descripcion}: <b>{fmtMoneySign(g.monto)}</b>
                </span>
              ))}
            </div>
          </div>
        )}

        {r?.observacion && (
          <div className="mb-3 text-[12px] text-gy600"><b>Obs.:</b> {r.observacion}</div>
        )}

        {/* Acciones */}
        {modo === "none" ? (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => enviar("validado")} disabled={saving}
              className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold bg-g700 text-white rounded-[8px] hover:bg-g600 disabled:opacity-50">
              <i className="ti ti-check text-[14px]" /> Validado
            </button>
            <button onClick={() => { setModo("diferencia"); setRecibido(String(item.efectivoEsperado)); }} disabled={saving}
              className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold bg-white text-red-700 border-2 border-red-200 rounded-[8px] hover:bg-red-50 disabled:opacity-50">
              <i className="ti ti-alert-triangle text-[14px]" /> Diferencia
            </button>
            {(yaValidado || yaDiferencia) && (
              <span className="text-[11px] text-gy400">Podés volver a validar para corregir.</span>
            )}
          </div>
        ) : (
          <div className="rounded-[10px] border-2 border-red-200 bg-red-50/40 p-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-gy500 mb-1">Efectivo recibido</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] font-bold text-gy500">$</span>
                  <input type="number" inputMode="decimal" autoFocus
                    value={recibido} onChange={(e) => setRecibido(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 border-2 border-gy200 rounded-[8px] text-[15px] font-bold bg-white focus:outline-none focus:border-g500" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-gy500 mb-1">Diferencia calculada</label>
                <div className={`px-3 py-2 rounded-[8px] text-[15px] font-bold ${(parseFloat(recibido || "0") - item.efectivoEsperado) < 0 ? "text-red-600" : "text-g700"}`}>
                  {(() => { const d = (parseFloat(recibido || "0") - item.efectivoEsperado); return `${d >= 0 ? "+" : ""}${fmtMoneySign(d)}`; })()}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-gy500 mb-1">Observación (opcional)</label>
              <input type="text" value={obs} onChange={(e) => setObs(e.target.value)}
                placeholder="Motivo / detalle de la diferencia…"
                className="w-full px-3 py-2 border-2 border-gy200 rounded-[8px] text-[12px] bg-white focus:outline-none focus:border-g500" />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => enviar("diferencia")} disabled={saving}
                className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold bg-red-600 text-white rounded-[8px] hover:bg-red-700 disabled:opacity-50">
                <i className="ti ti-device-floppy text-[14px]" /> Registrar diferencia
              </button>
              <button onClick={() => { setModo("none"); setRecibido(""); }} disabled={saving}
                className="px-3.5 py-2 text-[12px] font-medium bg-white text-gy600 border border-gy200 rounded-[8px] hover:bg-gy50">
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Marca (o reabre) una diferencia de rendición de caja como resuelta — ej.
// "descontado al cadete" o "corregido con la veterinaria". No cambia los
// montos ya sellados, solo deja constancia de que se revisó para que deje
// de aparecer entre las pendientes (ver filtro "Ocultar resueltas").
function ResolverDiferencia({ row }: { row: RevisadoRow }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [nota, setNota] = useState("");
  const [saving, setSaving] = useState(false);

  async function enviar(resuelta: boolean) {
    setSaving(true);
    const res = await fetch("/api/caja/diferencias/resolver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rendicionId: row.id, resuelta, nota: resuelta ? nota : undefined }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { toast("error", json.error ?? "No se pudo guardar"); return; }
    toast("success", resuelta ? "Diferencia marcada como resuelta ✓" : "Diferencia reabierta");
    setEditando(false);
    setNota("");
    router.refresh();
  }

  if (row.resuelta) {
    return (
      <div className="flex flex-col gap-0.5">
        {row.resuelvePor && <span className="text-[10px] text-gy400">por {row.resuelvePor}</span>}
        <button type="button" onClick={() => enviar(false)} disabled={saving}
          className="text-[11px] font-medium text-gy500 hover:text-gy800 underline self-start disabled:opacity-50">
          Reabrir
        </button>
      </div>
    );
  }

  if (!editando) {
    return (
      <button type="button" onClick={() => setEditando(true)}
        className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-g700 border border-g200 rounded-[6px] hover:bg-g50 whitespace-nowrap">
        <i className="ti ti-check text-[12px]" /> Marcar resuelta
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 min-w-[220px]">
      <input type="text" autoFocus value={nota} onChange={(e) => setNota(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") enviar(true); if (e.key === "Escape") setEditando(false); }}
        placeholder="Ej: descontado al cadete"
        className="flex-1 px-2 py-1 border-2 border-g300 rounded-[6px] text-[11px] focus:outline-none focus:border-g500" />
      <button type="button" onClick={() => enviar(true)} disabled={saving}
        className="px-2 py-1 bg-g700 text-white rounded-[6px] text-[11px] font-medium hover:bg-g800 disabled:opacity-50">
        <i className="ti ti-check text-[12px]" />
      </button>
      <button type="button" onClick={() => setEditando(false)} disabled={saving}
        className="px-1 text-gy400 hover:text-gy700">
        <i className="ti ti-x text-[12px]" />
      </button>
    </div>
  );
}

function Metric({ label, value, sub, accent, danger }: { label: string; value: string; sub?: string; accent?: boolean; danger?: boolean }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-gy400 font-semibold mb-0.5">{label}</div>
      <div className={`text-[20px] font-bold ${danger ? "text-red-600" : accent ? "text-g700" : "text-gy900"}`}>{value}</div>
      {sub && <div className="text-[10px] text-gy400 mt-0.5">{sub}</div>}
    </div>
  );
}
