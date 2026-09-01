import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Topbar } from "@/components/layout/Topbar";
import { esDireccion, landingPathForRole } from "@/lib/utils/roles";
import { todayISO } from "@/lib/utils/dates";
import { ControlCaja } from "@/components/caja/ControlCaja";
import type { RendicionCadete, RevisadoRow } from "@/components/caja/ControlCaja";

// Lee con cliente admin (service role, sin cookie): Next.js cachearía esos
// fetch y mostraría cajas viejas tras validar. Forzamos render dinámico.
export const dynamic = "force-dynamic";

export default async function CajaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: rolRow } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!esDireccion(rolRow?.rol)) redirect(landingPathForRole(rolRow?.rol));

  const { fecha: fechaParam } = await searchParams;
  const fecha = fechaParam || todayISO();

  const admin = createAdminClient();

  // El API de Supabase limita a 1000 filas por request (ver mismo patrón en
  // inicio/page.tsx). La caja abierta de un cadete puede superar eso largo,
  // así que paginamos hasta traer todo — si no, los totales y el "sellado"
  // de retiros al validar quedan truncados silenciosamente.
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

  // Pendientes = caja abierta de cada cadete: retiros/gastos NO validados
  // (rendicion_id NULL), sin importar el día. El corte lo marca la validación.
  const [retiros, gastos, { data: revisadosRaw }] = await Promise.all([
    fetchAllRows((from, to) =>
      admin.from("retiros")
        .select("personal_id, importe_declarado, metodo_pago, fecha_operativa, personal:personal_id(nombre)")
        .is("rendicion_id", null).eq("anulado", false).lte("fecha_operativa", fecha)
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      admin.from("gastos")
        .select("personal_id, monto, descripcion, tipo, fecha_operativa, personal:personal_id(nombre)")
        .is("rendicion_id", null).lte("fecha_operativa", fecha)
        .range(from, to)
    ),
    admin.from("rendiciones_caja")
      .select("*, personal:personal_id(nombre)")
      .in("estado", ["validado", "diferencia"])
      .order("fecha_operativa", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(500),
  ]);

  // Agregación por cadete.
  const map = new Map<string, RendicionCadete>();
  const ensure = (id: string, nombre: string) => {
    if (!map.has(id)) {
      map.set(id, {
        personalId: id, nombre,
        totalEfectivo: 0, totalDigital: 0, totalRecaudado: 0,
        retirosEfectivo: 0, retirosDigital: 0,
        gastos: [], totalGastos: 0, efectivoEsperado: 0,
        fechaDesde: null, fechaHasta: null,
        rendicion: null,
      });
    }
    return map.get(id)!;
  };

  // Amplía el rango de fechas (YYYY-MM-DD) que abarca la caja abierta del cadete.
  const ampliarRango = (a: RendicionCadete, f: string | null | undefined) => {
    if (!f) return;
    if (!a.fechaDesde || f < a.fechaDesde) a.fechaDesde = f;
    if (!a.fechaHasta || f > a.fechaHasta) a.fechaHasta = f;
  };

  for (const r of retiros ?? []) {
    const nombre = (r.personal as { nombre?: string } | null)?.nombre ?? "Sin nombre";
    const a = ensure(r.personal_id, nombre);
    const m = Number(r.importe_declarado ?? 0);
    if (r.metodo_pago === "efectivo") { a.totalEfectivo += m; a.retirosEfectivo += 1; }
    else { a.totalDigital += m; a.retirosDigital += 1; }
    ampliarRango(a, r.fecha_operativa);
  }
  for (const g of gastos ?? []) {
    const nombre = (g.personal as { nombre?: string } | null)?.nombre ?? "Sin nombre";
    const a = ensure(g.personal_id, nombre);
    a.gastos.push({ descripcion: g.descripcion, monto: Number(g.monto ?? 0), tipo: g.tipo });
    a.totalGastos += Number(g.monto ?? 0);
    ampliarRango(a, g.fecha_operativa);
  }
  const items = Array.from(map.values()).sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
  for (const a of items) {
    a.totalRecaudado = a.totalEfectivo + a.totalDigital;
    a.efectivoEsperado = a.totalEfectivo - a.totalGastos;
    a.rendicion = null; // caja abierta: aún sin validar
  }

  const revisados: RevisadoRow[] = (revisadosRaw ?? []).map((x) => ({
    id: x.id,
    nombre: (x.personal as { nombre?: string } | null)?.nombre ?? "Sin nombre",
    fecha: x.fecha_operativa,
    totalRecaudado: Number(x.total_recaudado ?? 0),
    totalEfectivo: Number(x.total_efectivo ?? 0),
    totalDigital: Number(x.total_digital ?? 0),
    totalGastos: Number(x.total_gastos ?? 0),
    efectivoEsperado: Number(x.efectivo_esperado ?? 0),
    importeValidado: Number(x.importe_validado ?? 0),
    diferencia: Number(x.diferencia ?? 0),
    estado: x.estado,
    observacion: x.observacion ?? null,
  }));

  return (
    <div>
      <Topbar title="Control de Caja — Logística" />
      <div className="p-6 space-y-4">
        <ControlCaja fecha={fecha} items={items} revisados={revisados} />
      </div>
    </div>
  );
}
