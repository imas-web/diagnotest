import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generarReciboSGE } from "@/lib/interpracsys/recibo";

const ROLES_PERMITIDOS = ["cobranzas", "super_admin"];
const ESTADOS = ["pendiente", "adjudicado", "diferencia", "no_corresponde"];

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  adjudicado: "Adjudicado",
  diferencia: "Diferencia",
  no_corresponde: "No corresponde",
};

async function requireRol() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado", status: 401 as const };
  const { data: profile } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!profile || !ROLES_PERMITIDOS.includes(profile.rol)) {
    return { error: "No tenés permiso para validar cobranzas", status: 403 as const };
  }
  return { user };
}

const fmt = (n: number) => "$" + (n ?? 0).toLocaleString("es-AR");

export async function POST(req: Request) {
  const guard = await requireRol();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: { controlId?: string; estado?: string; importeValidado?: number; detalle?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const controlId = body.controlId;
  const estado = body.estado ?? "";
  const detalle = (body.detalle ?? "").trim() || null;
  const validado = Number(body.importeValidado) || 0;
  if (!controlId) return NextResponse.json({ error: "Falta el control" }, { status: 400 });
  if (!ESTADOS.includes(estado)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });

  const admin = createAdminClient();

  const { data: prev, error: prevErr } = await admin
    .from("control_cobranzas")
    .select("id, retiro_id, estado, importe_declarado, importe_validado, detalle, recibo_sge_numero, retiro:retiro_id(fecha_operativa, metodo_pago, veterinaria:veterinaria_id(codigo))")
    .eq("id", controlId)
    .single();
  if (prevErr || !prev) return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });

  type RetiroEmbed = {
    fecha_operativa: string;
    metodo_pago: string | null;
    veterinaria: { codigo: string | null }[] | { codigo: string | null } | null;
  };
  const retiroEmbed = (Array.isArray(prev.retiro) ? prev.retiro[0] : prev.retiro) as RetiroEmbed | undefined;
  const veterinaria = retiroEmbed
    ? (Array.isArray(retiroEmbed.veterinaria) ? retiroEmbed.veterinaria[0] : retiroEmbed.veterinaria)
    : null;

  const diferencia = validado - (Number(prev.importe_declarado) || 0);

  const { error: updErr } = await admin
    .from("control_cobranzas")
    .update({
      estado,
      importe_validado: validado,
      diferencia,
      detalle,
      responsable_id: guard.user.id,
    })
    .eq("id", controlId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  // Registro en auditoría — usa el retiro como entidad para que el ID coincida
  // con el que se ve en las demás pantallas.
  const obs = detalle ? ` · obs: ${detalle}` : "";
  const { error: audErr } = await admin.from("auditoria").insert({
    entidad: "cobranza",
    entidad_id: prev.retiro_id,
    accion: "Validación",
    campo_modificado: "estado",
    valor_anterior: ESTADO_LABEL[prev.estado] ?? prev.estado,
    valor_nuevo: `${ESTADO_LABEL[estado] ?? estado} · validado ${fmt(validado)} (decl. ${fmt(prev.importe_declarado)}, dif. ${fmt(diferencia)})${obs}`,
    usuario_id: guard.user.id,
  });
  if (audErr) return NextResponse.json({ error: audErr.message }, { status: 400 });

  // Al adjudicar, replicar el cobro en el SGE para que genere el recibo. El
  // "numero" es correlativo (0002-00000001…) y se asigna una sola vez por
  // control: en un reintento se reutiliza el mismo, para no duplicar el
  // recibo allá.
  let recibo: { ok: boolean; info?: string } | null = null;
  if (estado === "adjudicado" && retiroEmbed) {
    let numeroRecibo = prev.recibo_sge_numero;
    if (!numeroRecibo) {
      const { data: nuevoNumero, error: numeroErr } = await admin.rpc("siguiente_recibo_sge_numero");
      if (numeroErr || !nuevoNumero) {
        return NextResponse.json({ error: numeroErr?.message ?? "No se pudo asignar el número de recibo" }, { status: 400 });
      }
      numeroRecibo = nuevoNumero;
      await admin.from("control_cobranzas").update({ recibo_sge_numero: numeroRecibo }).eq("id", controlId);
    }

    const resultado = await generarReciboSGE({
      codigoCliente: veterinaria?.codigo,
      fechaOperativa: retiroEmbed.fecha_operativa,
      importe: validado,
      metodoPago: retiroEmbed.metodo_pago,
      numero: numeroRecibo,
    });
    await admin.from("control_cobranzas").update({
      recibo_sge_id: resultado.ok ? resultado.idRecibo : null,
      recibo_sge_estado: resultado.ok ? "ok" : "error",
      recibo_sge_error: resultado.ok ? null : resultado.error,
      recibo_sge_actualizado_at: new Date().toISOString(),
    }).eq("id", controlId);
    recibo = resultado.ok ? { ok: true, info: resultado.info } : { ok: false, info: resultado.error };
  }

  revalidatePath("/cobranzas");
  return NextResponse.json({ ok: true, recibo });
}
