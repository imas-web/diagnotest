import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Elimina definitivamente una conversación (y por cascada sus miembros y
// mensajes) — para limpiar duplicados o pruebas. Reservado a super_admin:
// borra el historial para todos los que participaban, no solo para quien
// pide la baja. General no se puede borrar por acá.
const ROLES_PERMITIDOS = ["super_admin"];

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: perfil } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!perfil || !ROLES_PERMITIDOS.includes(perfil.rol)) {
    return NextResponse.json({ error: "No tenés permiso para eliminar conversaciones" }, { status: 403 });
  }

  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const id = body.id;
  if (!id) return NextResponse.json({ error: "Falta la conversación" }, { status: 400 });

  const admin = createAdminClient();

  const { data: conv } = await admin.from("chat_conversaciones").select("id, tipo, nombre").eq("id", id).single();
  if (!conv) return NextResponse.json({ error: "No existe esa conversación" }, { status: 404 });
  if (conv.tipo === "general") return NextResponse.json({ error: "General no se puede eliminar" }, { status: 400 });

  // Adjuntos del bucket, para no dejar archivos huérfanos.
  const { data: archivos } = await admin.storage.from("chat-adjuntos").list(id);
  if (archivos?.length) {
    await admin.storage.from("chat-adjuntos").remove(archivos.map((a) => `${id}/${a.name}`));
  }

  const { error } = await admin.from("chat_conversaciones").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("auditoria").insert({
    entidad: "chat_conversacion",
    entidad_id: id,
    accion: "Eliminación",
    campo_modificado: "conversación",
    valor_anterior: conv.tipo === "grupo" ? `Grupo: ${conv.nombre ?? ""}` : "DM",
    valor_nuevo: "Eliminada definitivamente",
    usuario_id: user.id,
  });

  return NextResponse.json({ ok: true });
}
