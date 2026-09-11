import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Lista de gente a la que se le puede mandar un DM. Se resuelve con el
// cliente admin a propósito: la política de SELECT de profiles no deja leer
// perfiles ajenos a cualquier rol (solo a algunos, ej. super_admin), así
// que alguien como cobranzas o chat consultando profiles directo desde el
// navegador se quedaba sin resultados — Grupos sí funcionaba porque ya se
// resolvía así. Solo se devuelve lo necesario para mostrar la lista.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: perfil } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!perfil || perfil.rol === "personal_logistica") {
    return NextResponse.json({ error: "Sin acceso al chat" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: contactos, error } = await admin
    .from("profiles")
    .select("id, nombre, email, rol")
    .neq("id", user.id)
    .neq("rol", "personal_logistica")
    .eq("activo", true)
    .order("nombre");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ contactos: contactos ?? [] });
}
