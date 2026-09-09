import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Roles que pueden resolver duplicados sospechosos. Como ambos perfiles
// (logística y preanalítica) actúan sobre la misma fila de retiros, el que
// resuelve primero impacta para todos.
const ROLES_PERMITIDOS = ["jefe_logistica", "preanalitica", "dueno", "super_admin"];

type Accion = "confirmar" | "anular";

async function resolverUno(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  accion: Accion,
  usuarioId: string,
): Promise<{ yaResuelto?: boolean; error?: string }> {
  // Solo se puede resolver un retiro que siga marcado como sospechoso:
  // si otro perfil ya lo resolvió, esta llamada no afecta nada.
  const { data: retiro } = await admin
    .from("retiros")
    .select("id, estado, veterinaria_texto_original, codigo_original")
    .eq("id", id)
    .single();

  if (!retiro) return { error: "Retiro no encontrado" };
  if (retiro.estado !== "duplicado_sospechoso") return { yaResuelto: true };

  // confirmar = es válido (no es duplicado) → vuelve a 'registrado'.
  if (accion === "confirmar") {
    const { error } = await admin.from("retiros").update({ estado: "registrado" }).eq("id", id);
    if (error) return { error: error.message };
    return {};
  }

  // anular = es un duplicado real → se ANULA (no se borra): queda anulado=true,
  // así no suma a muestras ni a los totales y sale de las bandejas, pero el
  // registro se conserva para auditoría. Logística/preanalítica no borran datos.
  const { error } = await admin
    .from("retiros")
    .update({ anulado: true, estado: "anulado" })
    .eq("id", id);
  if (error) return { error: error.message };

  await admin.from("auditoria").insert({
    entidad: "retiro",
    entidad_id: id,
    accion: "Anulación",
    campo_modificado: "estado",
    valor_anterior: "Duplicado sospechoso",
    valor_nuevo: `Anulado (duplicado) · ${retiro.codigo_original ?? ""} ${retiro.veterinaria_texto_original ?? ""}`.trim(),
    usuario_id: usuarioId,
  });

  return {};
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!ROLES_PERMITIDOS.includes(profile?.rol ?? "")) {
    return NextResponse.json({ error: "Sin permisos para resolver duplicados" }, { status: 403 });
  }

  let body: { id?: string; ids?: string[]; accion?: Accion };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const { accion } = body;
  if (accion !== "confirmar" && accion !== "anular") {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Lote: varios retiros de una.
  if (Array.isArray(body.ids)) {
    const ids = body.ids.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (!ids.length) return NextResponse.json({ error: "Falta seleccionar retiros" }, { status: 400 });

    let procesados = 0;
    let yaResueltos = 0;
    const errores: { id: string; error: string }[] = [];
    for (const id of ids) {
      const res = await resolverUno(admin, id, accion, user.id);
      if (res.error) errores.push({ id, error: res.error });
      else if (res.yaResuelto) yaResueltos++;
      else procesados++;
    }

    return NextResponse.json({ ok: true, procesados, yaResueltos, errores });
  }

  // Uno solo (flujo original).
  const { id } = body;
  if (!id) return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });

  const res = await resolverUno(admin, id, accion, user.id);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 400 });
  if (res.yaResuelto) return NextResponse.json({ ok: true, yaResuelto: true });
  return NextResponse.json({ ok: true });
}
