import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { PillStatus } from "@/components/ui/PillStatus";
import { formatDateTime } from "@/lib/utils/dates";
import { PedidoActions } from "@/components/forms/PedidoActions";
import { retiroResuelvePedido } from "@/lib/pedidos/match";
import Link from "next/link";

// El aviso "detectamos tu retiro" lee retiros con el cliente admin (service
// role, sin cookie): esos fetch los cachearía Next.js y mostraría candidatos
// viejos. Forzamos render dinámico para que el aviso refleje lo recién cargado.
export const dynamic = "force-dynamic";

export default async function PedidosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  const isPersonal = profile?.rol === "personal_logistica";
  const esStaff = ["jefe_logistica", "dueno", "super_admin"].includes(profile?.rol ?? "");

  // Veterinarias fijas que hoy no generan pedido (sin zona / sin cadete / 2+
  // cadetes). Aviso para que logística deje la zona resuelta. Solo para staff.
  let fijasSinResolver = 0;
  if (esStaff) {
    const { count } = await supabase
      .from("veterinarias_fijas_estado")
      .select("id", { count: "exact", head: true })
      .neq("motivo", "ok");
    fijasSinResolver = count ?? 0;
  }

  let query = supabase
    .from("pedidos_retiro")
    .select(`
      id, estado, urgente, detalle, fecha_limite, resuelto_en, reasignaciones, created_at, veterinaria_id,
      veterinaria:veterinaria_id(nombre, codigo),
      personal_asignado:personal_asignado_id(nombre, id),
      creado_por:creado_por_id(nombre)
    `)
    .order("created_at", { ascending: false });

  let persId: string | null = null;
  if (isPersonal) {
    const { data: pers } = await supabase.from("personal").select("id").eq("profile_id", user.id).single();
    persId = pers?.id ?? null;
    if (persId) query = query.eq("personal_asignado_id", persId);
  }

  const { data: pedidos } = await query;

  // Para el cadete: detectar qué pedidos abiertos ya tienen un retiro suyo que
  // coincide (veterinaria + fecha), para mostrar el aviso verde anticipado.
  const pedidoConMatch = new Set<string>();
  if (isPersonal && persId) {
    // Cliente admin para que el aviso vea exactamente los mismos retiros que el
    // API de resolución (sin que la RLS pueda mostrar algo distinto). El filtro
    // por personal_id = persId mantiene el alcance al cadete autenticado.
    const { data: candidatos } = await createAdminClient()
      .from("retiros")
      .select("fecha_operativa, veterinaria_id, veterinaria_texto_original, created_at")
      .eq("personal_id", persId)
      .is("pedido_id", null)
      .eq("anulado", false);
    for (const p of pedidos ?? []) {
      if (p.estado === "resuelto" || p.estado === "cancelado") continue;
      const vetNombre = (p.veterinaria as { nombre?: string } | null)?.nombre;
      const pm = { veterinaria_id: p.veterinaria_id, vetNombre, created_at: p.created_at };
      if ((candidatos ?? []).some((r) => retiroResuelvePedido(pm, r))) pedidoConMatch.add(p.id);
    }
  }

  const activos = pedidos?.filter((p) => p.estado === "asignado" || p.estado === "en_proceso") ?? [];
  const vencidos = pedidos?.filter((p) => p.estado === "vencido") ?? [];
  const resueltos = pedidos?.filter((p) => p.estado === "resuelto") ?? [];

  // El listado muestra solo pedidos abiertos: los resueltos y cancelados
  // salen de la vista (quedan registrados y contados en las estadísticas).
  const visibles = (pedidos ?? []).filter((p) => p.estado !== "resuelto" && p.estado !== "cancelado");

  const estadoStyle: Record<string, string> = {
    asignado: "border-l-4 border-l-blue-500",
    en_proceso: "border-l-4 border-l-blue-400",
    vencido: "border-l-4 border-l-red-500",
    resuelto: "border-l-4 border-l-g500 opacity-75",
    cancelado: "border-l-4 border-l-gy300 opacity-50",
  };

  const canCreate = ["jefe_logistica", "super_admin"].includes(profile?.rol ?? "");

  return (
    <div>
      <Topbar
        title="Pedidos de Retiro"
        actions={canCreate ? (
          <Link href="/pedidos/nuevo" className="flex items-center gap-1.5 px-3.5 py-2 bg-g800 text-white text-[12px] font-medium rounded-[6px] hover:bg-g700">
            <i className="ti ti-plus" /> Crear pedido
          </Link>
        ) : undefined}
      />
      <div className="p-6 space-y-4">
        {fijasSinResolver > 0 && (
          <Link href="/admin/veterinarias"
            className="flex items-start gap-3 bg-amber-bg border border-amber/40 rounded-[10px] px-4 py-3 text-[12px] text-amber-text hover:bg-amber-bg/70">
            <i className="ti ti-alert-triangle text-[16px] mt-0.5 shrink-0" />
            <div className="flex-1">
              <strong>{fijasSinResolver} veterinaria{fijasSinResolver !== 1 ? "s" : ""} fija{fijasSinResolver !== 1 ? "s" : ""} sin resolver</strong> — hoy no generan pedido automático (falta zona o cadete en la zona).
            </div>
            <span className="underline shrink-0">Ver detalle →</span>
          </Link>
        )}

        {vencidos.length > 0 && (
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-[10px] px-4 py-3 text-[12px] text-blue-800">
            <i className="ti ti-map-pin text-[16px] mt-0.5 shrink-0" />
            <div>
              <strong>{activos.length + vencidos.length} pedidos activos</strong> — {vencidos.length} superaron el tiempo límite y fueron reasignados automáticamente.
            </div>
          </div>
        )}

        <div className="grid grid-cols-5 gap-3">
          <StatCard label="Activos" value={activos.length} accent="blue" />
          <StatCard label="Vencidos" value={vencidos.length} accent="danger" />
          <StatCard label="Resueltos hoy" value={resueltos.length} />
          <StatCard label="Tiempo prom." value="1h 52m" accent="warn" />
          <StatCard label="Esta semana" value={pedidos?.length ?? 0} />
        </div>

        {/* Filter chips */}
        <div className="flex gap-1.5">
          {["Todos", "Activos", "Vencidos", "Resueltos"].map((f, i) => (
            <button key={f} className={`px-3 py-1.5 rounded-full border text-[11px] transition-all ${i === 0 ? "bg-g800 text-white border-g800" : "bg-white text-gy600 border-gy200 hover:border-g400 hover:text-g700"}`}>
              {f}
            </button>
          ))}
        </div>

        {/* Pedidos list */}
        <div className="space-y-3">
          {visibles.map((p) => {
            const vet = p.veterinaria as any;
            const personal = p.personal_asignado as any;
            const creado_por = p.creado_por as any;
            const isVencido = p.estado === "vencido";

            const minutesDiff = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 60000);
            const hours = Math.floor(minutesDiff / 60);
            const mins = minutesDiff % 60;
            const demora = `${hours}h ${mins}m`;

            return (
              <div key={p.id} className={`bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden ${estadoStyle[p.estado] ?? ""}`}>
                <div className="px-4 py-3 bg-gy50 border-b border-gy100 flex items-center gap-2.5 flex-wrap">
                  <span className="font-mono text-[12px] font-medium text-gy600">{p.id.slice(0, 8).toUpperCase()}</span>
                  <span className="text-[14px] font-semibold text-gy900 flex-1">{vet?.nombre ?? "—"}</span>
                  {vet?.codigo && <span className="text-[11px] text-gy400">{vet.codigo}</span>}
                  <PillStatus variant={p.estado === "asignado" || p.estado === "en_proceso" ? "asignado" : p.estado === "vencido" ? "vencido" : p.estado === "resuelto" ? "resuelto" : "grey"} />
                  {p.urgente && <PillStatus variant="urgente" />}
                  <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${isVencido ? "bg-red-50 text-red-600" : "bg-gy100 text-gy600"}`}>
                    ⏱ {demora}
                  </span>
                </div>
                <div className="px-4 py-3.5">
                  <div className="flex gap-5 mb-3 flex-wrap">
                    <div>
                      <div className="text-[9px] uppercase tracking-wide text-gy400 font-semibold mb-1">Asignado a</div>
                      <div className="text-[14px] font-semibold">{personal?.nombre ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wide text-gy400 font-semibold mb-1">Creado por</div>
                      <div className="text-[13px] text-gy600">{creado_por?.nombre ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wide text-gy400 font-semibold mb-1">Fecha límite</div>
                      <div className="text-[13px] text-gy600">{formatDateTime(p.fecha_limite)}</div>
                    </div>
                    {p.detalle && (
                      <div className="flex-1">
                        <div className="text-[9px] uppercase tracking-wide text-gy400 font-semibold mb-1">Detalle</div>
                        <div className="text-[12px] text-gy600">{p.detalle}</div>
                      </div>
                    )}
                  </div>

                  {p.estado === "resuelto" ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] px-2.5 py-1 bg-g50 text-g700 rounded-full font-medium">
                        ✓ Resuelto por {personal?.nombre}
                      </span>
                    </div>
                  ) : (
                    <PedidoActions pedidoId={p.id} estado={p.estado} isPersonal={isPersonal} hasMatch={pedidoConMatch.has(p.id)} />
                  )}

                  {isVencido && (
                    <div className="mt-2">
                      <PillStatus variant="observado" label="Reasignación automática activada" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {!visibles.length && (
            <div className="py-12 text-center text-gy400">No hay pedidos pendientes</div>
          )}
        </div>
      </div>
    </div>
  );
}
