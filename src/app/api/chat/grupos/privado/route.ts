import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Cuando alguien de afuera le manda un mensaje a un grupo, no se lo suma al
// grupo compartido (ahí vería los mensajes de cualquier otro ajeno que
// también le haya escrito, y viceversa) — se le arma una conversación
// aparte, privada, solo entre esa persona y los miembros actuales del
// grupo al momento de escribir. Si dos personas de afuera le escriben al
// mismo grupo, quedan en conversaciones separadas entre sí.
//
// Se resuelve con service role: hay que leer los miembros del grupo
// original (no forma parte de la política de SELECT de chat_miembros para
// alguien que no es miembro) y crear la conversación nueva sin depender de
// releerla con RLS (mismo problema de orden que el DM).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: perfil } = await supabase.from("profiles").select("rol, nombre").eq("id", user.id).single();
  if (!perfil || perfil.rol === "personal_logistica") {
    return NextResponse.json({ error: "Sin acceso al chat" }, { status: 403 });
  }

  let body: { grupoId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const grupoId = body.grupoId;
  if (!grupoId) return NextResponse.json({ error: "Falta el grupo" }, { status: 400 });

  const admin = createAdminClient();
  const { data: grupo } = await admin.from("chat_conversaciones").select("id, tipo, nombre").eq("id", grupoId).maybeSingle();
  if (!grupo || grupo.tipo !== "grupo") return NextResponse.json({ error: "Ese grupo no existe" }, { status: 404 });

  const clave = `grp:${grupoId}:${user.id}`;

  const { data: existente } = await admin
    .from("chat_conversaciones").select("id").eq("dm_clave", clave).maybeSingle();

  let conversacionId = existente?.id ?? null;

  if (!conversacionId) {
    const { data: miembrosGrupo } = await admin
      .from("chat_miembros").select("profile_id").eq("conversacion_id", grupoId);
    const idsMiembros = (miembrosGrupo ?? []).map((m) => m.profile_id).filter((id) => id !== user.id);

    conversacionId = crypto.randomUUID();
    const nombreConv = `${grupo.nombre ?? "Grupo"} · ${perfil.nombre}`;
    const { error } = await admin
      .from("chat_conversaciones")
      .insert({ id: conversacionId, tipo: "grupo", nombre: nombreConv, dm_clave: clave });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const filas = [user.id, ...idsMiembros].map((profile_id) => ({ conversacion_id: conversacionId, profile_id }));
    await admin.from("chat_miembros").upsert(filas, { onConflict: "conversacion_id,profile_id", ignoreDuplicates: true });
  }

  const { data: conv } = await admin
    .from("chat_conversaciones").select("id, tipo, nombre, dm_clave, created_at").eq("id", conversacionId).single();

  return NextResponse.json({ ok: true, conversacionId, conversacion: conv });
}
