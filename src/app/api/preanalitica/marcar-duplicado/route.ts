import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidarPreanalitica } from "@/lib/preanalitica/revalidar";

// Preanalítica detecta a veces un "repetido" a mano (viendo las bolsas), sin
// que el detector automático lo haya marcado. En vez de un flujo nuevo, esto
// reutiliza el mismo camino que ya existe para duplicados: pone el retiro en
// estado 'duplicado_sospechoso' para que aparezca en Retiros → Duplicados,
// donde ya se puede Confirmar o Anular. El control sale de Observados (queda
// resuelto acá, no en la etapa de calidad de la muestra).
const ROLES_PERMITIDOS = ["preanalitica", "super_admin", "dueno"];

// La variante en lote (varios controles de una) es más fácil de usar mal por
// error (marca muchos retiros de golpe), así que queda reservada a super_admin
// aunque el resto de estos roles pueda seguir marcando de a uno.
const ROLES_LOTE = ["super_admin"];

async function marcarUno(admin: ReturnType<typeof createAdminClient>, controlId: string, usuarioId: string) {
  const { data: control, error: controlErr } = await admin
    .from("control_preanalitica")
    .select("id, retiro_id")
    .eq("id", controlId)
    .single();
  if (controlErr || !control) return "Registro no encontrado";

  const { data: retiro, error: retiroErr } = await admin
    .from("retiros")
    .select("id, estado, anulado, codigo_original, veterinaria_texto_original")
    .eq("id", control.retiro_id)
    .single();
  if (retiroErr || !retiro) return "Retiro no encontrado";

  if (retiro.anulado) return "El retiro ya está anulado";

  if (retiro.estado !== "duplicado_sospechoso") {
    const { error: updRetiroErr } = await admin
      .from("retiros")
      .update({ estado: "duplicado_sospechoso" })
      .eq("id", retiro.id);
    if (updRetiroErr) return updRetiroErr.message;

    await admin.from("auditoria").insert({
      entidad: "retiro",
      entidad_id: retiro.id,
      accion: "Marcado como duplicado (manual, preanalítica)",
      campo_modificado: "estado",
      valor_anterior: retiro.estado,
      valor_nuevo: `duplicado_sospechoso · ${retiro.codigo_original ?? ""} ${retiro.veterinaria_texto_original ?? ""}`.trim(),
      usuario_id: usuarioId,
    });
  }

  // Sale de Observados: el retiro ahora se resuelve desde Duplicados.
  const { error: updControlErr } = await admin
    .from("control_preanalitica")
    .update({ estado: "ok" })
    .eq("id", controlId);
  if (updControlErr) return updControlErr.message;

  return null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!profile || !ROLES_PERMITIDOS.includes(profile.rol)) {
    return NextResponse.json({ error: "No tenés permiso para esta acción" }, { status: 403 });
  }

  let body: { controlId?: string; controlIds?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const admin = createAdminClient();

  // Lote: varios controles de una (solo super_admin).
  if (Array.isArray(body.controlIds)) {
    if (!ROLES_LOTE.includes(profile.rol)) {
      return NextResponse.json({ error: "Marcar en lote es exclusivo de super_admin" }, { status: 403 });
    }
    const ids = body.controlIds.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (!ids.length) return NextResponse.json({ error: "Falta seleccionar controles" }, { status: 400 });

    const errores: { controlId: string; error: string }[] = [];
    for (const id of ids) {
      const err = await marcarUno(admin, id, user.id);
      if (err) errores.push({ controlId: id, error: err });
    }

    revalidarPreanalitica();
    revalidatePath("/retiros/duplicados");
    return NextResponse.json({ ok: true, procesados: ids.length - errores.length, errores });
  }

  // Uno solo (flujo original, disponible para preanalítica/super_admin/dueño).
  const controlId = body.controlId;
  if (!controlId) return NextResponse.json({ error: "Falta el control" }, { status: 400 });

  const err = await marcarUno(admin, controlId, user.id);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  revalidarPreanalitica();
  revalidatePath("/retiros/duplicados");
  return NextResponse.json({ ok: true });
}
