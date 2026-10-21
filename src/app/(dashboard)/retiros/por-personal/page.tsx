import { createClient } from "@/lib/supabase/server";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { PillStatus } from "@/components/ui/PillStatus";
import { fmtMoneySign } from "@/lib/utils/format";
import { formatTime, todayISO } from "@/lib/utils/dates";
import { RecaudadoHoy } from "@/components/caja/RecaudadoHoy";

export default async function PorPersonalPage({
  searchParams,
}: {
  searchParams: Promise<{ personal?: string; fecha?: string }>;
}) {
  const supabase = await createClient();
  const today = todayISO();
  const { personal: personalParam, fecha: fechaParam } = await searchParams;
  const fecha = fechaParam || today;

  const { data: personal } = await supabase.from("personal").select("id, nombre").eq("activo", true).order("nombre");

  // Cadete seleccionado: el del filtro, o el primero de la lista por defecto.
  const selectedId = personalParam || personal?.[0]?.id || "";
  const selected = personal?.find((p) => p.id === selectedId) ?? personal?.[0] ?? null;

  const { data: retiros } = await supabase
    .from("retiros")
    .select("*, veterinaria:veterinaria_id(codigo), control_preanalitica:control_preanalitica(estado), control_cobranzas:control_cobranzas(estado)")
    .eq("personal_id", selectedId)
    .eq("fecha_operativa", fecha)
    .eq("anulado", false)
    .neq("estado", "duplicado_sospechoso" as never)
    .order("timestamp_carga", { ascending: true });

  const muestras = retiros?.reduce((s, r) => s + (r.cantidad_muestras ?? 0), 0) ?? 0;
  const importe = retiros?.reduce((s, r) => s + (r.importe_declarado ?? 0), 0) ?? 0;
  const importeEfectivo = retiros?.reduce((s, r) => s + (r.metodo_pago === "efectivo" ? (r.importe_declarado ?? 0) : 0), 0) ?? 0;
  const importeDigital = importe - importeEfectivo;

  return (
    <div>
      <Topbar title="Retiros por Personal" />
      <div className="p-6 space-y-4">
        {/* Form GET: al enviar recarga la página con ?personal=&fecha= */}
        <form className="flex gap-2.5 items-center flex-wrap">
          <select name="personal" defaultValue={selectedId}
            className="px-3 py-2 border-2 border-gy200 rounded-[6px] text-[13px] bg-gy50 focus:outline-none focus:border-g500 w-48">
            {(personal ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <input type="date" name="fecha" defaultValue={fecha}
            className="px-3 py-2 border-2 border-gy200 rounded-[6px] text-[13px] bg-gy50 focus:outline-none focus:border-g500 w-40" />
          <button type="submit" className="flex items-center gap-1.5 px-3.5 py-2 bg-g800 text-white text-[12px] font-medium rounded-[6px] hover:bg-g700">
            <i className="ti ti-filter" /> Filtrar
          </button>
        </form>

        <div className="grid grid-cols-4 gap-3.5">
          <StatCard label="Retiros del día" value={retiros?.length ?? 0} />
          <StatCard label="Muestras" value={muestras} />
          <StatCard label="Total recaudado" value={fmtMoneySign(importe)} accent="green" />
          <StatCard label="Pre. pendiente" value={retiros?.filter((r) => (r.control_preanalitica as any)?.[0]?.estado === "pendiente").length ?? 0} accent="warn" />
        </div>

        <RecaudadoHoy fecha={fecha} />

        {selected && (
          <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
            <div className="px-4 py-3.5 border-b border-gy100 flex items-center gap-3 flex-wrap">
              <span className="text-[14px] font-semibold flex-1">{selected.nombre} · {fecha}</span>
              <span className="text-[11px] text-gy400">Efectivo: <b className="text-gy700">{fmtMoneySign(importeEfectivo)}</b></span>
              <span className="text-[11px] text-gy400">Digital: <b className="text-gy700">{fmtMoneySign(importeDigital)}</b></span>
              <span className="text-[11px] text-gy400">Total a rendir:</span>
              <PillStatus variant="ok" label={fmtMoneySign(importe)} />
            </div>
            <div className="table-scroll">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-gy50">
                    {["Código", "Hora", "Veterinaria", "Muestras", "Importe", "Pago", "Pre.", "Cob."].map((h) => (
                      <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(retiros ?? []).map((r) => {
                    const preEst = (r.control_preanalitica as any)?.[0]?.estado ?? "pendiente";
                    const cobEst = (r.control_cobranzas as any)?.[0]?.estado ?? "pendiente";
                    return (
                      <tr key={r.id} className="hover:bg-gy50 border-b border-gy100 last:border-0">
                        <td className="px-3.5 py-2.5 font-mono text-[11px] text-g700">{r.codigo_original ?? (r.veterinaria as any)?.codigo ?? "—"}</td>
                        <td className="px-3.5 py-2.5">{formatTime(r.timestamp_carga)}</td>
                        <td className="px-3.5 py-2.5">{r.veterinaria_texto_original}</td>
                        <td className="px-3.5 py-2.5 text-center font-semibold">{r.cantidad_muestras}</td>
                        <td className="px-3.5 py-2.5">{fmtMoneySign(r.importe_declarado)}</td>
                        <td className="px-3.5 py-2.5 text-gy600">{r.importe_declarado > 0 ? (r.metodo_pago === "efectivo" ? "Efectivo" : "Digital") : "—"}</td>
                        <td className="px-3.5 py-2.5"><PillStatus variant={preEst === "ok" ? "ok" : "pendiente"} /></td>
                        <td className="px-3.5 py-2.5"><PillStatus variant={cobEst === "adjudicado" ? "ok" : "pendiente"} /></td>
                      </tr>
                    );
                  })}
                  {!retiros?.length && (
                    <tr><td colSpan={8} className="py-8 text-center text-gy400">Sin retiros para este filtro</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
