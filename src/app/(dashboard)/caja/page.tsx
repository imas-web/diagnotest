import { redirect } from "next/navigation";
import { getMyProfile } from "@/lib/supabase/server";
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
  searchParams: Promise<{ fecha?: string; tab?: string; desde?: string; hasta?: string }>;
}) {
  const { user, profile: rolRow } = await getMyProfile();
  if (!user) redirect("/login");
  if (!esDireccion(rolRow?.rol)) redirect(landingPathForRole(rolRow?.rol));

  const { fecha: fechaParam, tab, desde, hasta } = await searchParams;
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
  const [retiros, gastos, { data: revisadosRaw, error: revisadosErr }] = await Promise.all([
    // El .order("id") es necesario: sin un orden explícito, Postgres no
    // garantiza la misma secuencia entre dos consultas paginadas con
    // .range() — una fila podía salir en dos "páginas" distintas y
    // contarse dos veces (totales duplicados que un refresh corregía al
    // tener suerte con el orden). Solo se notaba con >1000 pendientes
    // acumulados (ahí arranca la paginación).
    fetchAllRows((from, to) =>
      admin.from("retiros")
        .select("personal_id, importe_declarado, metodo_pago, fecha_operativa, personal:personal_id(nombre)")
        .is("rendicion_id", null).eq("anulado", false).neq("estado", "duplicado_sospechoso" as never).lte("fecha_operativa", fecha)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      admin.from("gastos")
        .select("personal_id, monto, descripcion, tipo, fecha_operativa, personal:personal_id(nombre)")
        .is("rendicion_id", null).lte("fecha_operativa", fecha)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    (() => {
      // Importante: el rango desde/hasta se filtra ACÁ (antes del límite de
      // filas), no en el cliente — si no, con más de 500 rendiciones
      // validadas en total, elegir un rango viejo (ej. de hace un mes)
      // nunca mostraba nada: esas filas ya habían quedado afuera del
      // "limit" antes de que el filtro de fecha pudiera aplicarse.
      // "resuelta_por" se resuelve aparte (abajo) y no acá embebido: un
      // embed de un FK agregado por migración puede fallar si PostgREST
      // todavía no refrescó su caché de relaciones, y ahí rompe TODA la
      // consulta (no solo ese campo) sin que quede a la vista.
      let q = admin.from("rendiciones_caja")
        .select("*, personal:personal_id(nombre)")
        .in("estado", ["validado", "diferencia"]);
      if (desde) q = q.gte("fecha_operativa", desde);
      if (hasta) q = q.lte("fecha_operativa", hasta);
      return q.order("fecha_operativa", { ascending: false }).order("updated_at", { ascending: false }).limit(2000);
    })(),
  ]);
  if (revisadosErr) console.error("[caja] error al traer rendiciones_caja:", revisadosErr.message);

  // Nombres de quién resolvió cada diferencia (join aparte, ver comentario arriba).
  const resuelvePorIds = Array.from(new Set((revisadosRaw ?? []).map((x) => x.resuelta_por).filter(Boolean)));
  const nombreResuelvePor = new Map<string, string>();
  if (resuelvePorIds.length) {
    const { data: profs } = await admin.from("profiles").select("id, nombre").in("id", resuelvePorIds);
    for (const p of profs ?? []) nombreResuelvePor.set(p.id, p.nombre);
  }

  // Agregación por cadete + día operativo: los cadetes rinden la caja con
  // corte diario, así que una caja pendiente de varios días atrás se muestra
  // como una tarjeta por día (no un solo total mezclando todo el rango).
  const map = new Map<string, RendicionCadete>();
  const ensure = (id: string, nombre: string, fecha: string) => {
    const key = id + "|" + fecha;
    if (!map.has(key)) {
      map.set(key, {
        personalId: id, nombre, fecha,
        totalEfectivo: 0, totalDigital: 0, totalRecaudado: 0,
        retirosEfectivo: 0, retirosDigital: 0,
        gastos: [], totalGastos: 0, efectivoEsperado: 0,
        rendicion: null,
      });
    }
    return map.get(key)!;
  };

  for (const r of retiros ?? []) {
    const nombre = (r.personal as { nombre?: string } | null)?.nombre ?? "Sin nombre";
    const a = ensure(r.personal_id, nombre, r.fecha_operativa);
    const m = Number(r.importe_declarado ?? 0);
    if (r.metodo_pago === "efectivo") { a.totalEfectivo += m; a.retirosEfectivo += 1; }
    else { a.totalDigital += m; a.retirosDigital += 1; }
  }
  for (const g of gastos ?? []) {
    const nombre = (g.personal as { nombre?: string } | null)?.nombre ?? "Sin nombre";
    const a = ensure(g.personal_id, nombre, g.fecha_operativa);
    a.gastos.push({ descripcion: g.descripcion, monto: Number(g.monto ?? 0), tipo: g.tipo });
    a.totalGastos += Number(g.monto ?? 0);
  }
  // Más antiguo primero: son los cortes atrasados, los que más urge revisar.
  const items = Array.from(map.values()).sort((x, y) => x.fecha.localeCompare(y.fecha) || x.nombre.localeCompare(y.nombre, "es"));
  for (const a of items) {
    a.totalRecaudado = a.totalEfectivo + a.totalDigital;
    a.efectivoEsperado = a.totalEfectivo - a.totalGastos;
    a.rendicion = null; // caja abierta: aún sin validar
  }

  const revisados: RevisadoRow[] = (revisadosRaw ?? []).map((x) => ({
    id: x.id,
    personalId: x.personal_id,
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
    resuelta: !!x.resuelta,
    resuelvePor: x.resuelta_por ? (nombreResuelvePor.get(x.resuelta_por) ?? null) : null,
    notaResolucion: x.nota_resolucion ?? null,
  }));

  return (
    <div>
      <Topbar title="Control de Caja — Logística" />
      <div className="p-6 space-y-4">
        <ControlCaja fecha={fecha} items={items} revisados={revisados}
          initialTab={tab === "revisado" ? "revisado" : "pendientes"}
          initialDesde={desde ?? ""} initialHasta={hasta ?? ""} />
      </div>
    </div>
  );
}
