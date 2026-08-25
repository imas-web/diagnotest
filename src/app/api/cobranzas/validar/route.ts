import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
    .select("id, retiro_id, estado, importe_declarado, importe_validado, detalle")
    .eq("id", controlId)
    .single();
  if (prevErr || !prev) return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });

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

  revalidatePath("/cobranzas");
  return NextResponse.json({ ok: true });
}
