import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SELECT_CONVERSACIONES } from "@/components/chat/chatShared";

// Lista de mis conversaciones (+ General) con los datos de sus miembros.
// Con service role a propósito: chat_miembros(profile_id, ..., profiles(...))
// hace un join a profiles, y la política de SELECT de profiles no deja leer
// perfiles ajenos a cualquier rol — con el cliente de sesión, alguien sin
// ese permiso veía sus conversaciones pero sin el nombre de la otra
// persona (quedaba en null y cae al genérico "Conversación").
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: perfil } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!perfil || perfil.rol === "personal_logistica") {
    return NextResponse.json({ error: "Sin acceso al chat" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: misMiembros } = await admin.from("chat_miembros").select("conversacion_id").eq("profile_id", user.id);
  const ids = (misMiembros ?? []).map((m) => m.conversacion_id);

  const orParts = ["tipo.eq.general"];
  if (ids.length) orParts.push(`id.in.(${ids.join(",")})`);

  const { data: conversaciones, error } = await admin
    .from("chat_conversaciones")
    .select(SELECT_CONVERSACIONES)
    .or(orParts.join(","))
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ conversaciones: conversaciones ?? [] });
}
