import { Fragment } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Topbar } from "@/components/layout/Topbar";
import { PillStatus } from "@/components/ui/PillStatus";
import { ReintentarRecibo } from "@/components/cobranzas/ReintentarRecibo";
import { fmtMoneySign } from "@/lib/utils/format";
import { formatDate, formatDateTime } from "@/lib/utils/dates";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const METODO_PAGO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  mercado_pago: "Mercado Pago",
  mercadopago: "Mercado Pago",
};

// Etiqueta legible para el encabezado de cada día (Hoy / Ayer / fecha larga).
function etiquetaFecha(iso: string): string {
  if (!iso) return "Sin fecha";
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);
  const f = (d: Date) => d.toISOString().slice(0, 10);
  if (iso === f(hoy)) return "Hoy";
  if (iso === f(ayer)) return "Ayer";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long",
  });
}

export default async function CobranzasValidadosPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; q?: string }>;
}) {
  const supabase = await createClient();
  const { desde, hasta, q } = await searchParams;

  let query = supabase
    .from("control_cobranzas")
    .select("*, retiro:retiro_id(id, codigo_original, veterinaria_texto_original, metodo_pago, fecha_operativa, personal:personal_id(nombre))")
    .eq("estado", "adjudicado")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (desde) query = query.gte("updated_at", desde + "T00:00:00Z");
  if (hasta) query = query.lte("updated_at", hasta + "T23:59:59Z");

  const { data: rows } = await query;

  const term = (q ?? "").trim().toLowerCase();
  const controles = !term
    ? (rows ?? [])
    : (rows ?? []).filter((c) => {
        const r = c.retiro as any;
        return [r?.personal?.nombre, r?.veterinaria_texto_original, r?.codigo_original]
          .some((v) => String(v ?? "").toLowerCase().includes(term));
      });

  // Resolver nombres de los responsables (RLS de profiles no deja leer otros perfiles).
  const respIds = Array.from(new Set(controles.map((c) => c.responsable_id).filter(Boolean)));
  const nombrePorId = new Map<string, string>();
  if (respIds.length) {
    const { data: profs } = await createAdminClient().from("profiles").select("id, nombre").in("id", respIds);
    for (const p of profs ?? []) nombrePorId.set(p.id, p.nombre);
  }

  // Agrupar por día → veterinaria, con subtotal de importe por veterinaria y total del día.
  type Grupo = { vete: string; filas: AnyRecord[]; total: number };
  type Dia = { fecha: string; vetes: Grupo[]; total: number };

  const porDia = new Map<string, Map<string, Grupo>>();
  for (const c of controles) {
    const fecha = String(c.updated_at ?? "").slice(0, 10);
    const r = c.retiro as AnyRecord;
    const vete = (r?.veterinaria_texto_original ?? "Sin veterinaria").trim() || "Sin veterinaria";
    if (!porDia.has(fecha)) porDia.set(fecha, new Map());
    const vetes = porDia.get(fecha)!;
    if (!vetes.has(vete)) vetes.set(vete, { vete, filas: [], total: 0 });
    const g = vetes.get(vete)!;
    g.filas.push(c);
    g.total += Number(c.importe_declarado) || 0;
  }

  const dias: Dia[] = Array.from(porDia.entries())
    .sort((a, b) => b[0].localeCompare(a[0])) // días más recientes primero
    .map(([fecha, vetes]) => {
      const grupos = Array.from(vetes.values()).sort((a, b) => a.vete.localeCompare(b.vete, "es"));
      const total = grupos.reduce((s, g) => s + g.total, 0);
      return { fecha, vetes: grupos, total };
    });

  return (
    <div>
      <Topbar title="Cobranzas — Validados"
        actions={
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-white border border-gy200 rounded-[6px] hover:bg-gy50">
            <i className="ti ti-download text-[13px]" /> Exportar
          </button>
        }
      />
      <div className="px-6 pt-4">
        <form method="get" className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1">Desde</label>
            <input type="date" name="desde" defaultValue={desde ?? ""}
              className="px-2.5 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1">Hasta</label>
            <input type="date" name="hasta" defaultValue={hasta ?? ""}
              className="px-2.5 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500" />
          </div>
          <div className="flex-1 min-w-[200px] max-w-[320px]">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1">Buscar (cadete, veterinaria, código)</label>
            <input type="text" name="q" defaultValue={q ?? ""} placeholder="Buscar…"
              className="w-full px-2.5 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500" />
          </div>
          <button type="submit"
            className="px-3.5 py-1.5 bg-g800 text-white text-[12px] font-medium rounded-[8px] hover:bg-g700">Filtrar</button>
        </form>
      </div>
      <div className="p-6">
        <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
          <div className="table-scroll">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-gy50">
                  {["Fecha retiro", "Fecha adjudicación", "Personal", "Veterinaria", "Código", "Importe", "Medio", "Observación", "Autorizado por", "Estado", "Recibo SGE"].map((h) => (
                    <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dias.map((dia) => (
                  <Fragment key={`dia-${dia.fecha}`}>
                    {/* Encabezado del día con total general del día */}
                    <tr className="bg-g800/[0.04]">
                      <td colSpan={5} className="px-3.5 py-2 text-[12px] font-bold text-g800 border-b border-gy200 capitalize">
                        {etiquetaFecha(dia.fecha)}
                      </td>
                      <td colSpan={6} className="px-3.5 py-2 text-[12px] font-bold text-g800 border-b border-gy200 text-right">
                        Total día: {fmtMoneySign(dia.total)}
                      </td>
                    </tr>
                    {dia.vetes.map((g) => (
                      <Fragment key={`vete-${dia.fecha}-${g.vete}`}>
                        {/* Detalle por retiro (fondo blanco) */}
                        {g.filas.map((c) => {
                          const r = c.retiro as AnyRecord;
                          return (
                            <tr key={c.id} className="bg-white hover:bg-gy50 border-b border-gy100">
                              <td className="px-3.5 py-2.5 text-gy600 whitespace-nowrap">{r?.fecha_operativa ? formatDate(r.fecha_operativa) : "—"}</td>
                              <td className="px-3.5 py-2.5 text-gy600 whitespace-nowrap">{formatDateTime(c.updated_at)}</td>
                              <td className="px-3.5 py-2.5 font-medium">{r?.personal?.nombre ?? "—"}</td>
                              <td className="px-3.5 py-2.5 max-w-[180px] truncate text-gy500" title={r?.veterinaria_texto_original ?? ""}>{r?.veterinaria_texto_original ?? "—"}</td>
                              <td className="px-3.5 py-2.5 font-mono text-[11px] text-gy500">{r?.codigo_original ?? "—"}</td>
                              <td className="px-3.5 py-2.5 font-semibold text-g700">{fmtMoneySign(c.importe_declarado)}</td>
                              <td className="px-3.5 py-2.5">{METODO_PAGO_LABEL[r?.metodo_pago as string] ?? "—"}</td>
                              <td className="px-3.5 py-2.5 text-gy600 max-w-[200px] truncate" title={c.detalle ?? ""}>{c.detalle || "—"}</td>
                              <td className="px-3.5 py-2.5 text-gy600">{c.responsable_id ? (nombrePorId.get(c.responsable_id) ?? "—") : "—"}</td>
                              <td className="px-3.5 py-2.5"><PillStatus variant="ok" label="Adjudicado" /></td>
                              <td className="px-3.5 py-2.5">
                                {c.recibo_sge_estado === "ok" ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-g700 bg-g50 border border-g200 rounded-full px-2 py-0.5">
                                    <i className="ti ti-check" /> #{c.recibo_sge_id}
                                  </span>
                                ) : c.recibo_sge_estado === "error" ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5 max-w-[160px] truncate" title={c.recibo_sge_error ?? ""}>
                                      <i className="ti ti-alert-triangle" /> Falló
                                    </span>
                                    <ReintentarRecibo controlId={c.id} importe={Number(c.importe_declarado) || 0} />
                                  </div>
                                ) : (
                                  <span className="text-gy300">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {/* Subtotal por veterinaria (debajo del grupo, color diferenciado) */}
                        <tr className="bg-g50 border-b-2 border-gy200">
                          <td className="px-3.5 py-1.5 text-[11px] font-semibold text-g700 uppercase tracking-wide" colSpan={3}>
                            Subtotal
                          </td>
                          <td className="px-3.5 py-1.5 font-semibold text-g800" colSpan={2} title={g.vete}>
                            <i className="ti ti-building-hospital text-[12px] mr-1 text-g500" />{g.vete}
                          </td>
                          <td className="px-3.5 py-1.5 font-bold text-g800">{fmtMoneySign(g.total)}</td>
                          <td className="px-3.5 py-1.5 text-[11px] text-g600" colSpan={5}>
                            {g.filas.length} retiro{g.filas.length !== 1 ? "s" : ""}
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
                {!controles?.length && (
                  <tr><td colSpan={11} className="py-10 text-center text-gy400">Sin validaciones en el período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
