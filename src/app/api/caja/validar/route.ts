import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esDireccion } from "@/lib/utils/roles";
import { fmtMoneySign } from "@/lib/utils/format";

// El control de caja (Control 1) es exclusivo de Dirección.
async function requireDireccion() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado", status: 401 as const };
  const { data: profile } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!esDireccion(profile?.rol)) return { error: "Solo Dirección puede validar la caja", status: 403 as const };
  return { user };
}

export async function POST(req: Request) {
  const guard = await requireDireccion();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: { personalId?: string; fecha?: string; estado?: string; importeValidado?: number; observacion?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const personalId = body.personalId;
  const fecha = body.fecha;
  const estado = body.estado;
  if (!personalId || !fecha) return NextResponse.json({ error: "Faltan datos del cadete o fecha" }, { status: 400 });
  if (estado !== "validado" && estado !== "diferencia") {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  const admin = createAdminClient();

  // El API de Supabase limita a 1000 filas por request (mismo límite que en
  // inicio/page.tsx y caja/page.tsx). Con cajas que acumulan miles de retiros
  // sin validar, hay que paginar para sumar bien — y, más abajo, sellarlos
  // por filtro en vez de juntar un .in() con miles de IDs (esa lista gigante
  // era justo lo que hacía fallar el guardado).
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

  // La "caja abierta" del cadete = todos sus retiros/gastos no validados
  // (rendicion_id NULL), sin importar el día. Recalculamos desde la base.
  const [retiros, gastos] = await Promise.all([
    fetchAllRows<{ id: string; importe_declarado: number; metodo_pago: string }>((from, to) =>
      admin.from("retiros").select("id, importe_declarado, metodo_pago")
        .eq("personal_id", personalId).eq("anulado", false).is("rendicion_id", null).lte("fecha_operativa", fecha)
        .range(from, to)
    ),
    fetchAllRows<{ id: string; monto: number }>((from, to) =>
      admin.from("gastos").select("id, monto")
        .eq("personal_id", personalId).is("rendicion_id", null).lte("fecha_operativa", fecha)
        .range(from, to)
    ),
  ]);

  if (retiros.length === 0 && gastos.length === 0) {
    return NextResponse.json({ error: "El cadete no tiene una caja abierta para validar" }, { status: 400 });
  }

  let totalEfectivo = 0, totalDigital = 0;
  for (const r of retiros ?? []) {
    const m = Number(r.importe_declarado ?? 0);
    if (r.metodo_pago === "efectivo") totalEfectivo += m;
    else totalDigital += m;
  }
  const totalRecaudado = totalEfectivo + totalDigital;
  const totalGastos = (gastos ?? []).reduce((s, g) => s + Number(g.monto ?? 0), 0);
  const efectivoEsperado = totalEfectivo - totalGastos;

  // Importe validado: si no hay diferencia coincide con el esperado.
  const importeValidado = estado === "validado"
    ? efectivoEsperado
    : Number(body.importeValidado);
  if (estado === "diferencia" && !Number.isFinite(importeValidado)) {
    return NextResponse.json({ error: "Ingresá el efectivo recibido" }, { status: 400 });
  }
  const diferencia = Math.round((importeValidado - efectivoEsperado) * 100) / 100;
  const observacion = (body.observacion ?? "").trim() || null;

  // 1) Crear la rendición (cierre de la caja). fecha_operativa = día del cierre.
  const { data: rend, error: upErr } = await admin.from("rendiciones_caja").insert({
    personal_id: personalId,
    fecha_operativa: fecha,
    total_efectivo: totalEfectivo,
    total_digital: totalDigital,
    total_recaudado: totalRecaudado,
    total_gastos: totalGastos,
    efectivo_esperado: efectivoEsperado,
    importe_validado: importeValidado,
    diferencia,
    estado,
    observacion,
    responsable_id: guard.user.id,
    updated_at: new Date().toISOString(),
  }).select("id").single();
  if (upErr || !rend) return NextResponse.json({ error: upErr?.message ?? "No se pudo crear la rendición" }, { status: 400 });

  // 2) Sellar los retiros/gastos de esta caja para que no vuelvan a sumar.
  // Se actualiza por el mismo filtro usado para traerlos (no por lista de
  // IDs): con miles de retiros abiertos, un .in() con todos los IDs arma una
  // URL enorme que Supabase rechaza.
  if (retiros.length) {
    const { error } = await admin.from("retiros").update({ rendicion_id: rend.id })
      .eq("personal_id", personalId).eq("anulado", false).is("rendicion_id", null).lte("fecha_operativa", fecha);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (gastos.length) {
    const { error } = await admin.from("gastos").update({ rendicion_id: rend.id })
      .eq("personal_id", personalId).is("rendicion_id", null).lte("fecha_operativa", fecha);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const resumen = estado === "validado"
    ? `Validado · efectivo esperado ${fmtMoneySign(efectivoEsperado)}`
    : `Diferencia ${diferencia >= 0 ? "+" : ""}${fmtMoneySign(diferencia)} · recibido ${fmtMoneySign(importeValidado)} vs esperado ${fmtMoneySign(efectivoEsperado)}`;

  const { error: audErr } = await admin.from("auditoria").insert({
    entidad: "rendicion_caja",
    entidad_id: rend.id,
    accion: "Validación de caja",
    campo_modificado: "estado",
    valor_anterior: null,
    valor_nuevo: resumen,
    usuario_id: guard.user.id,
  });
  if (audErr) return NextResponse.json({ error: audErr.message }, { status: 400 });

  return NextResponse.json({ ok: true, diferencia, efectivoEsperado, importeValidado });
}
