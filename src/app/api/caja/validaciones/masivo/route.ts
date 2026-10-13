import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esDireccion } from "@/lib/utils/roles";

// Validación masiva "OK, coincide" — misma acción que haría cada cadete desde
// su Resumen, pero disparada una sola vez por Dirección para arrancar la
// dinámica de validación diaria desde una fecha de corte en limpio (sin tener
// que insistirle a nadie por cajas previas a la capacitación).
async function requireDireccion() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado", status: 401 as const };
  const { data: profile } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!esDireccion(profile?.rol)) return { error: "Solo Dirección puede hacer esta validación masiva", status: 403 as const };
  return { user };
}

export async function POST() {
  const guard = await requireDireccion();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const admin = createAdminClient();

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

  const [retiros, gastos] = await Promise.all([
    fetchAllRows<{ personal_id: string; fecha_operativa: string }>((from, to) =>
      admin.from("retiros").select("personal_id, fecha_operativa")
        .is("rendicion_id", null).eq("anulado", false)
        .range(from, to)
    ),
    fetchAllRows<{ personal_id: string; fecha_operativa: string }>((from, to) =>
      admin.from("gastos").select("personal_id, fecha_operativa")
        .is("rendicion_id", null).eq("tipo", "diferencia_caja")
        .range(from, to)
    ),
  ]);

  const validadas = new Set(gastos.map((g) => `${g.personal_id}|${g.fecha_operativa}`));
  const pendientes = new Map<string, { personal_id: string; fecha_operativa: string }>();
  for (const r of retiros) {
    const key = `${r.personal_id}|${r.fecha_operativa}`;
    if (!validadas.has(key)) pendientes.set(key, r);
  }

  const filas = Array.from(pendientes.values()).map((p) => ({
    id: crypto.randomUUID(),
    personal_id: p.personal_id,
    tipo: "diferencia_caja" as const,
    descripcion: "Diferencia de caja (OK — coincide, validación inicial previa a capacitación)",
    monto: 0,
    fecha_operativa: p.fecha_operativa,
    comprobante_url: null,
    estado: "pendiente" as const,
  }));

  if (filas.length) {
    const { error } = await admin.from("gastos").insert(filas);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (filas.length) {
    await admin.from("auditoria").insert({
      entidad: "gastos",
      entidad_id: "validacion_masiva",
      accion: "Validación masiva de caja (previa a capacitación)",
      campo_modificado: "diferencia_caja",
      valor_anterior: null,
      valor_nuevo: `${filas.length} caja(s) marcadas OK — coincide`,
      usuario_id: guard.user.id,
    });
  }

  return NextResponse.json({ ok: true, marcadas: filas.length });
}
