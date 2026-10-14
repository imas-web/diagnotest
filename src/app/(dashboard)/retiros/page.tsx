import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Topbar } from "@/components/layout/Topbar";
import { PillStatus } from "@/components/ui/PillStatus";
import { StatCard } from "@/components/ui/StatCard";
import { fmtMoney } from "@/lib/utils/format";
import { formatDateTime, todayISO, daysAgoISO } from "@/lib/utils/dates";
import { EliminarRetiro } from "@/components/retiros/EliminarRetiro";
import Link from "next/link";

const METODO_PAGO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  mercado_pago: "Mercado Pago",
};

const FILTERS = [
  { key: "todos", label: "Todos" },
  { key: "hoy", label: "Hoy" },
  { key: "semana", label: "Esta semana" },
  { key: "pre_pendiente", label: "Pre. pendiente" },
  { key: "observados", label: "Observados" },
  { key: "urgentes", label: "Urgentes" },
] as const;

export default async function RetirosPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; desde?: string; hasta?: string; cod?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  const isPersonal = profile?.rol === "personal_logistica";
  // Dirección y super admin pueden eliminar registros manualmente.
  const canDelete = profile?.rol === "dueno" || profile?.rol === "super_admin";

  const { f, desde, hasta, cod } = await searchParams;
  // Por defecto, el personal de logística ve sus retiros de hoy
  const filter = f ?? (isPersonal ? "hoy" : "todos");

  const today = todayISO();
  const weekAgo = daysAgoISO(6);

  // Si es personal de logística, se acota a su propio personal_id.
  let personalId: string | null = null;
  if (isPersonal) {
    const { data: pers } = await supabase.from("personal").select("id").eq("profile_id", user.id).single();
    personalId = pers?.id ?? null;
  }

  let query = supabase
    .from("retiros")
    .select(`
      id, fecha_operativa, timestamp_carga, tipo, urgente, estado, sincronizado, anulado,
      cantidad_muestras, importe_declarado, metodo_pago, comprobante_url, veterinaria_texto_original, codigo_original,
      personal:personal_id(nombre),
      veterinaria:veterinaria_id(nombre, codigo),
      control_preanalitica:control_preanalitica(estado),
      control_cobranzas:control_cobranzas(estado)
    `)
    .eq("anulado", false)
    .order("timestamp_carga", { ascending: false })
    .limit(1000);

  if (personalId) query = query.eq("personal_id", personalId);

  // Los filtros de fecha van a la base de datos: si se aplicaran después del
  // límite, solo se filtrarían los últimos N cargados y las fechas viejas
  // quedarían invisibles. Así el rango pedido se trae completo desde la base.
  if (desde) query = query.gte("fecha_operativa", desde);
  if (hasta) query = query.lte("fecha_operativa", hasta);
  if (filter === "hoy") query = query.eq("fecha_operativa", today);
  if (filter === "semana") query = query.gte("fecha_operativa", weekAgo);

  const { data: allRetiros } = await query;

  const preOf = (r: any) => Array.isArray(r.control_preanalitica) ? r.control_preanalitica[0]?.estado : (r.control_preanalitica)?.estado;
  const cobOf = (r: any) => Array.isArray(r.control_cobranzas) ? r.control_cobranzas[0]?.estado : (r.control_cobranzas)?.estado;

  // Filtros que no son de fecha se resuelven en memoria sobre lo ya traído.
  const codTerm = (cod ?? "").trim().toLowerCase();
  const retiros = (allRetiros ?? []).filter((r) => {
    if (codTerm) {
      const code = `${r.codigo_original ?? ""} ${(r.veterinaria as any)?.codigo ?? ""}`.toLowerCase();
      if (!code.includes(codTerm)) return false;
    }
    switch (filter) {
      // Solo cuentan los que tienen un control real pendiente. Un retiro de 0
      // muestras no genera control de preanalítica (queda solo en logística),
      // así que no debe figurar como "pre. pendiente".
      case "pre_pendiente": return preOf(r) === "pendiente";
      case "observados": return preOf(r) === "observado" || cobOf(r) === "diferencia";
      case "urgentes": return r.urgente;
      default: return true;
    }
  });

  // Tarjetas de resumen: cuentas propias e independientes del filtro de la tabla.
  let statHoyQuery = supabase
    .from("retiros")
    .select("cantidad_muestras")
    .eq("anulado", false)
    .eq("fecha_operativa", today);
  let statTotalQuery = supabase
    .from("retiros")
    .select("id", { count: "exact", head: true })
    .eq("anulado", false);
  if (personalId) {
    statHoyQuery = statHoyQuery.eq("personal_id", personalId);
    statTotalQuery = statTotalQuery.eq("personal_id", personalId);
  }
  const [{ data: retirosHoy }, { count: totalCargados }] = await Promise.all([statHoyQuery, statTotalQuery]);
  const muestrasHoy = (retirosHoy ?? []).reduce((s, r) => s + (r.cantidad_muestras ?? 0), 0);

  return (
    <div>
      <Topbar
        title={isPersonal ? "Mis Retiros" : "Todos los Retiros"}
        actions={
          <Link href="/retiros/nuevo" className="flex items-center gap-1.5 px-3.5 py-2 bg-g800 text-white text-[12px] font-medium rounded-[6px] hover:bg-g700">
            <i className="ti ti-plus" /> Nuevo retiro
          </Link>
        }
      />
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-3 gap-3.5">
          <StatCard label="Retiros hoy" value={retirosHoy?.length ?? 0} />
          <StatCard label={isPersonal ? "Mis retiros" : "Total cargados"} value={totalCargados ?? 0} />
          <StatCard label="Muestras hoy" value={muestrasHoy} accent="warn" />
        </div>

        {/* Filter chips */}
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map((opt) => {
            const params = new URLSearchParams();
            params.set("f", opt.key);
            if (desde) params.set("desde", desde);
            if (hasta) params.set("hasta", hasta);
            if (cod) params.set("cod", cod);
            return (
              <Link key={opt.key} href={`/retiros?${params.toString()}`} scroll={false}
                className={`px-3 py-1.5 rounded-full border text-[11px] transition-all ${filter === opt.key ? "bg-g800 text-white border-g800" : "bg-white text-gy600 border-gy200 hover:border-g400 hover:text-g700"}`}>
                {opt.label}
              </Link>
            );
          })}
          <div className="flex-1" />
          {!isPersonal && (
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gy200 text-[11px] text-gy600 rounded-full hover:bg-gy50">
              <i className="ti ti-download text-[13px]" /> Exportar Excel
            </button>
          )}
        </div>

        {/* Filtros por fecha y código */}
        <form method="get" className="flex items-end gap-2 flex-wrap">
          <input type="hidden" name="f" value={filter} />
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
          <div className="min-w-[160px]">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1">Código</label>
            <input type="text" name="cod" defaultValue={cod ?? ""} placeholder="Código de veterinaria…"
              className="w-full px-2.5 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500" />
          </div>
          <button type="submit"
            className="px-3.5 py-1.5 bg-g800 text-white text-[12px] font-medium rounded-[8px] hover:bg-g700">Filtrar</button>
          {(desde || hasta || cod) && (
            <Link href={`/retiros?f=${filter}`}
              className="px-3 py-1.5 text-[12px] text-gy500 hover:text-gy700">Limpiar</Link>
          )}
        </form>

        {/* Table */}
        <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
          <div className="table-scroll">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-gy50">
                  <th className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">Fecha/hora</th>
                  {!isPersonal && <th className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">Personal</th>}
                  <th className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">Veterinaria</th>
                  <th className="px-3.5 py-2.5 text-center text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">Muestras</th>
                  <th className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">Importe</th>
                  <th className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">Pago</th>
                  <th className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">Preanalítica</th>
                  <th className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">Cobranzas</th>
                  <th className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200"></th>
                </tr>
              </thead>
              <tbody>
                {(retiros ?? []).map((r) => {
                  const preEstado = Array.isArray(r.control_preanalitica) ? r.control_preanalitica[0]?.estado : (r.control_preanalitica as any)?.estado;
                  const cobEstado = Array.isArray(r.control_cobranzas) ? r.control_cobranzas[0]?.estado : (r.control_cobranzas as any)?.estado;
                  return (
                    <tr key={r.id} className="hover:bg-gy50 border-b border-gy100 last:border-0">
                      <td className="px-3.5 py-2.5 text-gy600">{formatDateTime(r.timestamp_carga)}</td>
                      {!isPersonal && <td className="px-3.5 py-2.5 font-medium text-gy900">{(r.personal as any)?.nombre ?? "—"}</td>}
                      <td className="px-3.5 py-2.5 max-w-[140px] truncate">
                        {(r.veterinaria as any)?.nombre ?? r.veterinaria_texto_original}
                        {r.codigo_original && <span className="ml-1.5 font-mono text-[10px] text-gy400">{r.codigo_original}</span>}
                      </td>
                      <td className="px-3.5 py-2.5 text-center font-semibold">{r.cantidad_muestras}</td>
                      <td className="px-3.5 py-2.5">${fmtMoney(r.importe_declarado)}</td>
                      <td className="px-3.5 py-2.5 text-gy600">{METODO_PAGO_LABEL[r.metodo_pago as string] ?? "—"}</td>
                      <td className="px-3.5 py-2.5">
                        {/* Sin control de preanalítica (retiro de 0 muestras) → "—",
                            no "Pendiente": no hay nada que controlar. */}
                        <PillStatus variant={preEstado === "ok" ? "ok" : preEstado === "observado" ? "observado" : preEstado === "pendiente" ? "pendiente" : "grey"} />
                      </td>
                      <td className="px-3.5 py-2.5">
                        {/* Sin control de cobranzas (retiro de $0) → "—", no "Pendiente". */}
                        <PillStatus variant={cobEstado === "adjudicado" ? "ok" : cobEstado === "diferencia" ? "diferencia" : cobEstado === "pendiente" ? "pendiente" : "grey"} />
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {r.urgente && <PillStatus variant="urgente" />}
                          {!r.sincronizado && <PillStatus variant="nosync" />}
                          {r.comprobante_url && (
                            <a href={r.comprobante_url as string} target="_blank" rel="noopener noreferrer"
                              title="Ver ticket"
                              className="px-2 py-1 text-[11px] bg-white border border-gy200 rounded-[6px] hover:bg-gy50 flex items-center gap-1 text-g700">
                              <i className="ti ti-photo text-[13px]" />
                            </a>
                          )}
                          {canDelete && (
                            <EliminarRetiro retiroId={r.id} etiqueta={(r.veterinaria as any)?.nombre ?? r.veterinaria_texto_original} />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!retiros?.length && (
                  <tr><td colSpan={9} className="py-10 text-center text-gy400 text-sm">Sin retiros registrados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
