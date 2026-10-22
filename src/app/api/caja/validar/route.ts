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

  // El corte es por día: solo se sellan los retiros/gastos no validados de
  // ESE día operativo del cadete (no todo lo acumulado hasta esa fecha) —
  // así cada jornada se rinde por separado, como hacen los cadetes.
  // El .order("id") es necesario: sin un orden explícito, Postgres no
  // garantiza la misma secuencia entre dos consultas paginadas con .range()
  // — una fila podía salir en dos "páginas" y sumarse dos veces, sellando
  // una rendición con el total YA inflado (esto no se auto-corrige con un
  // refresh, a diferencia de la lectura en /caja).
  // Un retiro marcado "duplicado_sospechoso" todavía no está confirmado como
  // carga real (ver detect_duplicates()) — no se le cobra al cadete por algo
  // que puede ser la misma visita cargada dos veces. Mismo criterio que ya
  // usan preanalítica/cobranzas/dashboard; acá faltaba y era justo por lo que
  // la caja de un cadete podía dar más alto que lo que de verdad recaudó.
  const [retiros, gastos] = await Promise.all([
    fetchAllRows<{ id: string; importe_declarado: number; metodo_pago: string }>((from, to) =>
      admin.from("retiros").select("id, importe_declarado, metodo_pago")
        .eq("personal_id", personalId).eq("anulado", false).neq("estado", "duplicado_sospechoso" as never)
        .is("rendicion_id", null).eq("fecha_operativa", fecha)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<{ id: string; monto: number; invalidada_en: string | null }>((from, to) =>
      admin.from("gastos").select("id, monto, invalidada_en")
        .eq("personal_id", personalId).is("rendicion_id", null).eq("fecha_operativa", fecha)
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  if (retiros.length === 0 && gastos.length === 0) {
    return NextResponse.json({ error: "El cadete no tiene una caja abierta para validar" }, { status: 400 });
  }

  // Una diferencia de caja desactualizada (el cadete cargó/editó un retiro
  // después de declararla) sigue sellándose junto con el resto — ya es
  // historial, Dirección está validando con el dato real a mano — pero no
  // cuenta para el cálculo: ya no representa el efectivo actual.
  const gastosVigentes = gastos.filter((g) => !g.invalidada_en);

  let totalEfectivo = 0, totalDigital = 0;
  for (const r of retiros ?? []) {
    const m = Number(r.importe_declarado ?? 0);
    if (r.metodo_pago === "efectivo") totalEfectivo += m;
    else totalDigital += m;
  }
  const totalRecaudado = totalEfectivo + totalDigital;
  const totalGastos = gastosVigentes.reduce((s, g) => s + Number(g.monto ?? 0), 0);
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
  // Si tocaron "Diferencia" pero el importe recibido terminó coincidiendo
  // (ej. para dejar una observación sin que en realidad falte o sobre
  // nada), queda guardado como validado — lo que importa es el número, no
  // qué botón se tocó. Así no queda una "diferencia" de $0 para resolver.
  const estadoFinal = diferencia === 0 ? "validado" : estado;

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
    estado: estadoFinal,
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
      .eq("personal_id", personalId).eq("anulado", false).is("rendicion_id", null).eq("fecha_operativa", fecha);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (gastos.length) {
    const { error } = await admin.from("gastos").update({ rendicion_id: rend.id })
      .eq("personal_id", personalId).is("rendicion_id", null).eq("fecha_operativa", fecha);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const resumen = estadoFinal === "validado"
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
