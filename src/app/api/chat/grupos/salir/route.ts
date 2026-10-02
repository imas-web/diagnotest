import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Salir de un grupo (o de una rama privada armada por una difusión — mismo
// tipo "grupo", ver /api/chat/grupos/privado): borra la fila propia de
// chat_miembros. Se resuelve con el cliente admin porque no existe política
// de DELETE sobre chat_miembros (por diseño, nadie puede borrar la fila de
// otro) — acá se restringe a mano a la propia fila del usuario autenticado.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: { conversacionId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const conversacionId = body.conversacionId;
  if (!conversacionId) return NextResponse.json({ error: "Falta la conversación" }, { status: 400 });

  const admin = createAdminClient();
  const { data: conv } = await admin.from("chat_conversaciones").select("id, tipo").eq("id", conversacionId).maybeSingle();
  if (!conv) return NextResponse.json({ error: "Esa conversación no existe" }, { status: 404 });
  if (conv.tipo !== "grupo") return NextResponse.json({ error: "Solo se puede salir de un grupo" }, { status: 400 });

  const { error } = await admin
    .from("chat_miembros").delete()
    .eq("conversacion_id", conversacionId).eq("profile_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
