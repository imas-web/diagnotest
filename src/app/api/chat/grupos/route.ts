import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Lista de todos los grupos (canales de sector) para poder elegirlos como
// destino de un mensaje aunque no se sea miembro — el chat_conversaciones
// normal solo muestra las conversaciones propias (RLS), así que un grupo
// ajeno no aparecería nunca en "Nuevo mensaje" sin esto. Se resuelve con
// el cliente admin a propósito, sin exponer de más: solo id y nombre.
//
// Se excluyen las conversaciones "grupo" que en realidad son ramas privadas
// creadas por /api/chat/grupos/privado (mismo tipo, para heredar el permiso
// de insert sin ser miembro) — esas siempre tienen dm_clave seteado
// ("grp:<grupoId>:<remitenteId>"), a diferencia de un grupo real, que nunca
// lo tiene. Sin este filtro, la conversación privada de otra persona con un
// grupo aparecía acá como si fuera un grupo más, ofreciendo sumarse a ella.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: perfil } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!perfil || perfil.rol === "personal_logistica") {
    return NextResponse.json({ error: "Sin acceso al chat" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: grupos, error } = await admin
    .from("chat_conversaciones")
    .select("id, nombre")
    .eq("tipo", "grupo")
    .is("dm_clave", null)
    .order("nombre");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ grupos: grupos ?? [] });
}
