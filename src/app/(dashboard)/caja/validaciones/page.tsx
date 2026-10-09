import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { esDireccion, landingPathForRole } from "@/lib/utils/roles";
import { ValidacionCadetes, type CajaValidacion } from "@/components/caja/ValidacionCadetes";

// Lee con cliente admin (service role): mismo motivo que /caja (evita el
// bug de "0 filas" por un blip de sesión bajo carga).
export const dynamic = "force-dynamic";

export default async function ValidacionesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: rolRow } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!esDireccion(rolRow?.rol)) redirect(landingPathForRole(rolRow?.rol));

  const admin = createAdminClient();

  // El API de Supabase limita a 1000 filas por request (mismo patrón que
  // /caja). Caja abierta = retiros/gastos todavía sin rendir (rendicion_id
  // null), sin importar la fecha — un cadete puede arrastrar varios días.
  async function fetchAllRows<T>(
    build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
  ): Promise<T[]> {
    const rows: T[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(from, from + PAGE - 1);
      if (error || !data?.length) break;
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    return rows;
  }

  type RetiroRow = { personal_id: string; fecha_operativa: string; personal: { nombre?: string }[] | { nombre?: string } | null };
  type GastoDif = { personal_id: string; fecha_operativa: string };

  const [retiros, diferencias] = await Promise.all([
    fetchAllRows<RetiroRow>((from, to) =>
      admin.from("retiros")
        .select("personal_id, fecha_operativa, personal:personal_id(nombre)")
        .is("rendicion_id", null).eq("anulado", false)
        .range(from, to)
    ),
    fetchAllRows<GastoDif>((from, to) =>
      admin.from("gastos")
        .select("personal_id, fecha_operativa")
        .is("rendicion_id", null).eq("tipo", "diferencia_caja")
        .range(from, to)
    ),
  ]);

  const validadas = new Set(diferencias.map((d) => `${d.personal_id}|${d.fecha_operativa}`));

  const map = new Map<string, CajaValidacion>();
  for (const r of retiros) {
    const key = `${r.personal_id}|${r.fecha_operativa}`;
    if (!map.has(key)) {
      const personal = Array.isArray(r.personal) ? r.personal[0] : r.personal;
      map.set(key, {
        personalId: r.personal_id,
        nombre: personal?.nombre ?? "Sin nombre",
        fecha: r.fecha_operativa,
        retiros: 0,
        validado: validadas.has(key),
      });
    }
    map.get(key)!.retiros += 1;
  }

  // Más antiguo primero: son las cajas que más tiempo llevan sin validar.
  const cajas = Array.from(map.values()).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.nombre.localeCompare(b.nombre, "es"));
  const pendientes = cajas.filter((c) => !c.validado).length;

  return (
    <div>
      <Topbar title="Validación de cadetes" subtitle="¿Ya contaron y confirmaron su efectivo?" />
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
          <StatCard label="Cajas abiertas" value={cajas.length} />
          <StatCard label="Sin validar" value={pendientes} accent="danger" />
          <StatCard label="Ya validaron" value={cajas.length - pendientes} accent="green" />
        </div>

        <ValidacionCadetes cajas={cajas} />
      </div>
    </div>
  );
}
