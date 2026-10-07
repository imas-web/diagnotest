import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidarPreanalitica } from "@/lib/preanalitica/revalidar";

// Aplica un responsable a TODO lo pendiente de una etapa (Control 1 o
// Control 2), pisando lo que ya estuviera marcado: en la práctica, en cada
// etapa controla la/las misma(s) persona(s) durante todo el turno, así que
// quien lo aplique está confirmando "esto es lo vigente ahora", no
// compitiendo por quedarse con registros en blanco. Para corregir una ficha
// puntual sin tocar el resto, se sigue pudiendo editar desde su propia ficha.
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

  let body: { stage?: "c1" | "c2"; responsable?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const stage = body.stage;
  const responsable = (body.responsable ?? "")?.toString().trim() || null;
  if (stage !== "c1" && stage !== "c2") return NextResponse.json({ error: "Etapa inválida" }, { status: 400 });
  if (!responsable) return NextResponse.json({ error: "Marcá al menos una persona" }, { status: 400 });

  const admin = createAdminClient();
  const col = stage === "c1" ? "responsable_1" : "responsable_2";

  // Misma definición de etapa que usa la bandeja (ver etapaDe en
  // PreanaliticaBandeja): c1 = todavía sin Control 1 en OK; c2 = Control 1
  // ya OK, esperando el segundo.
  let sel = admin
    .from("control_preanalitica")
    .select("id, retiro:retiro_id!inner(anulado, estado)")
    .eq("estado", "pendiente")
    .eq("retiro.anulado", false)
    .neq("retiro.estado", "duplicado_sospechoso");
  sel = stage === "c1" ? sel.is("control_1", null) : sel.eq("control_1", "ok");

  const { data: filas, error: selErr } = await sel;
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 400 });

  const ids = (filas ?? []).map((f) => f.id);
  if (ids.length) {
    const { error: updErr } = await admin
      .from("control_preanalitica")
      .update({ [col]: responsable })
      .in("id", ids);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });
  }

  // Persistir el responsable activo de la etapa: los retiros NUEVOS de
  // Control 1 lo heredan vía el trigger create_controls_on_retiro (migración
  // 0018) — para Control 2 no hay trigger (un retiro nunca nace ya en
  // Control 2), pero igual queda guardado para trazabilidad.
  await admin
    .from("preanalitica_responsable_activo")
    .upsert({ stage, responsable, updated_at: new Date().toISOString() }, { onConflict: "stage" });

  await admin.from("auditoria").insert({
    entidad: "preanalitica",
    entidad_id: stage === "c1" ? "control_1" : "control_2",
    accion: `Responsable de ${stage === "c1" ? "Control 1" : "Control 2"} (turno)`,
    campo_modificado: col,
    valor_anterior: `${ids.length} registro(s) en la bandeja de ${stage === "c1" ? "Control 1" : "Control 2"}`,
    valor_nuevo: responsable,
    usuario_id: guard.user.id,
  });

  revalidarPreanalitica();
  return NextResponse.json({ ok: true, actualizados: ids.length });
}
