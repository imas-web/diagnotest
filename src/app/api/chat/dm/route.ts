import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Busca o crea la conversación 1 a 1 entre el usuario logueado y otro
// perfil. Se resuelve con el cliente admin (service role) a propósito: el
// primer mensaje de un DM tiene un problema de orden con RLS (recién creada,
// la conversación todavía no tiene miembros, así que ni el propio creador
// puede releerla para confirmar el insert) — acá no hace falta releer nada
// porque el service role no depende de las políticas de SELECT. De paso,
// si quedó una conversación húerfana de un intento fallido anterior (mismo
// dm_clave, sin miembros), la reutiliza en vez de chocar con el unique.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: perfil } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!perfil || perfil.rol === "personal_logistica") {
    return NextResponse.json({ error: "Sin acceso al chat" }, { status: 403 });
  }

  let body: { otroId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const otroId = body.otroId;
  if (!otroId || otroId === user.id) return NextResponse.json({ error: "Falta el destinatario" }, { status: 400 });

  const admin = createAdminClient();
  const { data: otro } = await admin.from("profiles").select("id, activo").eq("id", otroId).single();
  if (!otro || !otro.activo) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const clave = [user.id, otroId].sort().join("|");

  const { data: porClave } = await admin
    .from("chat_conversaciones").select("id").eq("dm_clave", clave).maybeSingle();

  let conversacionId = porClave?.id ?? null;

  // Red de contención por si quedó un DM viejo con dm_clave nulo o
  // desalineado (de antes de que esta ruta existiera): busca cualquier
  // conversación tipo dm donde los dos ya sean miembros, en vez de crear
  // una segunda. Si la encuentra, de paso le arregla el dm_clave.
  if (!conversacionId) {
    const { data: misDms } = await admin
      .from("chat_miembros")
      .select("conversacion_id, chat_conversaciones!inner(tipo)")
      .eq("profile_id", user.id)
      .eq("chat_conversaciones.tipo", "dm");
    const idsPropios = (misDms ?? []).map((m) => m.conversacion_id);
    if (idsPropios.length) {
      const { data: compartida } = await admin
        .from("chat_miembros")
        .select("conversacion_id")
        .eq("profile_id", otroId)
        .in("conversacion_id", idsPropios)
        .limit(1)
        .maybeSingle();
      if (compartida) {
        conversacionId = compartida.conversacion_id;
        await admin.from("chat_conversaciones").update({ dm_clave: clave }).eq("id", conversacionId);
      }
    }
  }

  if (!conversacionId) {
    conversacionId = crypto.randomUUID();
    const { error } = await admin.from("chat_conversaciones").insert({ id: conversacionId, tipo: "dm", dm_clave: clave });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Upsert de ambos miembros: cubre tanto el alta nueva como el caso de una
  // conversación huérfana que nunca llegó a tener miembros.
  await admin.from("chat_miembros").upsert(
    [{ conversacion_id: conversacionId, profile_id: user.id }, { conversacion_id: conversacionId, profile_id: otroId }],
    { onConflict: "conversacion_id,profile_id", ignoreDuplicates: true }
  );

  return NextResponse.json({ ok: true, conversacionId });
}
