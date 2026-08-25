import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { CobranzasBandeja } from "@/components/cobranzas/CobranzasBandeja";
import { fmtMoneySign } from "@/lib/utils/format";
import { landingPathForRole } from "@/lib/utils/roles";

// Caché corta; la validación de una cobranza revalida al instante (revalidatePath).
export const revalidate = 15;

const ROLES = ["cobranzas", "dueno", "super_admin"];
const PAGINA = 50;
const SELECT = `
  *,
  retiro:retiro_id!inner(
    id, importe_declarado, urgente, fecha_operativa, timestamp_carga, comentarios,
    veterinaria_texto_original, codigo_original, comprobante_url, metodo_pago,
    personal:personal_id(nombre),
    control_preanalitica:control_preanalitica(estado, etiquetas, detalle, cancelado, cancelado_motivo, comentario, fotos_urls)
  )`;

export default async function CobranzasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; fecha?: string; cadete?: string; ver?: string }>;
}) {
  // Guard de rol con la sesión; la LECTURA va con admin (rápida, sin RLS).
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await auth.from("profiles").select("rol").eq("id", user.id).single();
  if (!perfil || !ROLES.includes(perfil.rol)) redirect(landingPathForRole(perfil?.rol));

  const { q, fecha, cadete, ver } = await searchParams;
  const term = (q ?? "").trim();
  const limite = Math.min(600, Math.max(PAGINA, parseInt(ver ?? "", 10) || PAGINA));

  const admin = createAdminClient();

  // Consulta paginada (solo se traen `limite` filas → evita el freeze de traer
  // las ~900 de una). Búsqueda, fecha y cadete se resuelven en el servidor.
  let lista = admin.from("control_cobranzas").select(SELECT)
    .eq("estado", "pendiente").eq("retiro.anulado", false).neq("retiro.estado", "duplicado_sospechoso");
  let cnt = admin.from("control_cobranzas")
    .select("id, retiro:retiro_id!inner(anulado, estado, fecha_operativa, personal_id, codigo_original, veterinaria_texto_original)", { count: "exact", head: true })
    .eq("estado", "pendiente").eq("retiro.anulado", false).neq("retiro.estado", "duplicado_sospechoso");
  if (fecha) { lista = lista.eq("retiro.fecha_operativa", fecha); cnt = cnt.eq("retiro.fecha_operativa", fecha); }
  if (cadete) { lista = lista.eq("retiro.personal_id", cadete); cnt = cnt.eq("retiro.personal_id", cadete); }
  if (term) {
    const f = `codigo_original.ilike.%${term}%,veterinaria_texto_original.ilike.%${term}%`;
    lista = lista.or(f, { referencedTable: "retiro" });
    cnt = cnt.or(f, { referencedTable: "retiro" });
  }
  lista = lista.order("created_at", { ascending: true }).limit(limite);

  const [{ data: controles }, { count: total }, { data: montos }, { data: cadetes }] = await Promise.all([
    lista,
    cnt,
    admin.from("control_cobranzas").select("importe_declarado").eq("estado", "pendiente"),
    admin.from("personal").select("id, nombre").eq("activo", true).order("nombre"),
  ]);
  const totalPendiente = (montos ?? []).reduce((s, m) => s + (m.importe_declarado ?? 0), 0);

  return (
    <div>
      <Topbar title="Cobranzas — Pendientes" />
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-3.5">
          <StatCard label="Pendientes" value={total ?? 0} accent="warn" />
          <StatCard label="Total pendiente (efectivo)" value={fmtMoneySign(totalPendiente)} />
        </div>

        <CobranzasBandeja controles={controles ?? []} total={total ?? 0} q={term} fecha={fecha ?? ""} cadete={cadete ?? ""} cadetes={cadetes ?? []} ver={limite} />
      </div>
    </div>
  );
}
