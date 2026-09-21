import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SELECT_MENSAJE } from "@/components/chat/chatShared";

// Mensajes de una conversación. Con service role a propósito: el select
// trae remitente:remitente_id(...) embebido (para mostrar quién mandó cada
// mensaje), y esa relación pasa por profiles — cuya política de SELECT no
// deja leer perfiles ajenos a cualquier rol. El control de acceso (ser
// miembro, o que sea General) se hace acá a mano porque el service role no
// pasa por RLS.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: perfil } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!perfil || perfil.rol === "personal_logistica") {
    return NextResponse.json({ error: "Sin acceso al chat" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const conversacionId = searchParams.get("conversacion_id");
  if (!conversacionId) return NextResponse.json({ error: "Falta la conversación" }, { status: 400 });

  const admin = createAdminClient();
  const { data: conv } = await admin.from("chat_conversaciones").select("tipo").eq("id", conversacionId).maybeSingle();
  if (!conv) return NextResponse.json({ mensajes: [] });

  if (conv.tipo !== "general") {
    const { data: soyMiembro } = await admin
      .from("chat_miembros").select("profile_id")
      .eq("conversacion_id", conversacionId).eq("profile_id", user.id).maybeSingle();
    // No es miembro (ej. le mandó a un grupo ajeno como difusión): no ve el
    // historial, pero no es un error — se devuelve vacío en silencio.
    if (!soyMiembro) return NextResponse.json({ mensajes: [] });
  }

  const { data: mensajes, error } = await admin
    .from("chat_mensajes")
    .select(SELECT_MENSAJE)
    .eq("conversacion_id", conversacionId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ mensajes: mensajes ?? [] });
}
