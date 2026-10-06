import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarPushConversacion } from "@/lib/server/enviarPush";

// Antes el chat insertaba el mensaje directo desde el navegador (RLS cubría
// el permiso). Ahora pasa por acá — se sigue insertando igual (mismo chequeo
// que tenía la política de RLS: miembro real, o conversación general/grupo
// para difusión), pero de paso permite disparar el push real a los
// destinatarios desde el servidor, sin depender de que SU pestaña esté
// despierta para que les suene/notifique.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: perfil } = await supabase.from("profiles").select("rol, nombre").eq("id", user.id).single();
  if (!perfil || perfil.rol === "personal_logistica") {
    return NextResponse.json({ error: "Sin acceso al chat" }, { status: 403 });
  }

  let body: {
    id?: string; conversacionId?: string; contenido?: string | null;
    adjuntoUrl?: string | null; adjuntoTipo?: string | null; adjuntoNombre?: string | null;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const { id, conversacionId, contenido, adjuntoUrl, adjuntoTipo, adjuntoNombre } = body;
  if (!id || !conversacionId) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  if (!(contenido ?? "").trim() && !adjuntoUrl) return NextResponse.json({ error: "Mensaje vacío" }, { status: 400 });

  const admin = createAdminClient();

  const { data: conv } = await admin
    .from("chat_conversaciones").select("id, tipo").eq("id", conversacionId).maybeSingle();
  if (!conv) return NextResponse.json({ error: "Esa conversación no existe" }, { status: 404 });

  // Mismo chequeo que tenía la política de RLS: miembro real, o general/grupo
  // (que admiten difusión sin ser miembro).
  if (conv.tipo !== "general" && conv.tipo !== "grupo") {
    const { data: miembro } = await admin
      .from("chat_miembros").select("profile_id")
      .eq("conversacion_id", conversacionId).eq("profile_id", user.id).maybeSingle();
    if (!miembro) return NextResponse.json({ error: "No sos miembro de esa conversación" }, { status: 403 });
  }

  const { error } = await admin.from("chat_mensajes").insert({
    id, conversacion_id: conversacionId, remitente_id: user.id,
    contenido: contenido ?? null, adjunto_url: adjuntoUrl ?? null, adjunto_tipo: adjuntoTipo ?? null, adjunto_nombre: adjuntoNombre ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const preview = adjuntoUrl ? (adjuntoTipo === "imagen" ? "📷 Foto" : "📎 Archivo") : (contenido ?? "Nuevo mensaje");
  // Se espera (no "fire and forget"): en una función serverless, el proceso
  // puede cortarse apenas se devuelve la respuesta, así que sin el await el
  // envío de push quedaría a mitad de camino la mayoría de las veces. Es
  // best-effort igual: si falla, no rompe el envío del mensaje en sí.
  try {
    await enviarPushConversacion({
      conversacionId, tipo: conv.tipo as "dm" | "grupo" | "general",
      remitenteId: user.id, titulo: perfil.nombre, cuerpo: preview,
    });
  } catch {
    /* el mensaje ya se mandó igual; el push es best-effort */
  }

  return NextResponse.json({ ok: true });
}
