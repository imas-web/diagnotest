import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidarPreanalitica } from "@/lib/preanalitica/revalidar";

// Solo para Control 1: a diferencia de Control 2 (una persona controla cada
// ficha, y por eso tiene su propio selector con precarga personal por
// cuenta — ver ControlCard), en Control 1 son 2 personas fijas que
// controlan TODO lo que entra durante el día. Por eso acá sí se pisa sin
// problema lo que haya en cada ficha pendiente: no es "quién controló yo"
// (que varía por cuenta), es un dato compartido ("quiénes están en Control
// 1 hoy"), así que cualquiera que lo aplique está confirmando lo mismo.
const ROLES_PERMITIDOS = ["preanalitica", "super_admin"];

async function requireRol() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado", status: 401 as const };
  const { data: profile } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!profile || !ROLES_PERMITIDOS.includes(profile.rol)) {
    return { error: "No tenés permiso para controlar preanalítica", status: 403 as const };
  }
  return { user };
}

export async function POST(req: Request) {
  const guard = await requireRol();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: { responsable?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const responsable = (body.responsable ?? "")?.toString().trim() || null;
  if (!responsable) return NextResponse.json({ error: "Marcá al menos una persona" }, { status: 400 });

  const admin = createAdminClient();

  // Todo lo que sigue en la bandeja de Control 1: pendiente, de retiros no
  // anulados ni duplicados, sin Control 1 todavía en OK.
  const { data: filas, error: selErr } = await admin
    .from("control_preanalitica")
    .select("id, retiro:retiro_id!inner(anulado, estado)")
    .eq("estado", "pendiente")
    .is("control_1", null)
    .eq("retiro.anulado", false)
    .neq("retiro.estado", "duplicado_sospechoso");
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 400 });

  const ids = (filas ?? []).map((f) => f.id);
  if (ids.length) {
    const { error: updErr } = await admin
      .from("control_preanalitica")
      .update({ responsable_1: responsable })
      .in("id", ids);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });
  }

  // Persistir el responsable activo de Control 1: los retiros nuevos lo
  // heredan vía el trigger create_controls_on_retiro (migración 0018), así
  // se "repite durante todo el día" sin tener que volver a aplicar.
  await admin
    .from("preanalitica_responsable_activo")
    .upsert({ stage: "c1", responsable, updated_at: new Date().toISOString() }, { onConflict: "stage" });

  await admin.from("auditoria").insert({
    entidad: "preanalitica",
    entidad_id: "control_1",
    accion: "Responsable de Control 1 (día)",
    campo_modificado: "responsable_1",
    valor_anterior: `${ids.length} registro(s) en la bandeja de Control 1`,
    valor_nuevo: responsable,
    usuario_id: guard.user.id,
  });

  revalidarPreanalitica();
  return NextResponse.json({ ok: true, actualizados: ids.length });
}
