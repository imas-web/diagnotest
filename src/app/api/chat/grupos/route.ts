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

// Crea un grupo nuevo (o, si ya existe uno con ese nombre, suma los
// miembros a ese) — reservado a dueño/super_admin, igual que el alta de los
// canales de sector existentes (Administración, Citología, etc.), para no
// llenar la lista de grupos sin control. Se resuelve con el cliente admin
// por el mismo motivo que /api/chat/dm: recién creada, la conversación no
// tiene miembros todavía y la política de SELECT exige serlo (o ser
// General), así que ni el propio creador podría releerla para confirmar.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: perfil } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!perfil || (perfil.rol !== "dueno" && perfil.rol !== "super_admin")) {
    return NextResponse.json({ error: "Solo dueño o super admin pueden crear grupos" }, { status: 403 });
  }

  let body: { nombre?: string; miembroIds?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const nombre = (body.nombre ?? "").trim();
  if (!nombre) return NextResponse.json({ error: "Falta el nombre del grupo" }, { status: 400 });
  const miembroIds = Array.from(new Set([...(body.miembroIds ?? []), user.id]));
  if (miembroIds.length < 2) return NextResponse.json({ error: "Elegí al menos un integrante" }, { status: 400 });

  const admin = createAdminClient();

  const { data: existente } = await admin
    .from("chat_conversaciones")
    .select("id, nombre")
    .eq("tipo", "grupo")
    .is("dm_clave", null)
    .ilike("nombre", nombre)
    .maybeSingle();

  let conversacionId = existente?.id ?? null;
  if (!conversacionId) {
    const { data: nuevo, error } = await admin
      .from("chat_conversaciones").insert({ tipo: "grupo", nombre }).select("id").single();
    if (error || !nuevo) return NextResponse.json({ error: error?.message ?? "No se pudo crear el grupo" }, { status: 400 });
    conversacionId = nuevo.id;
  }

  const { error: miembrosErr } = await admin.from("chat_miembros").upsert(
    miembroIds.map((profile_id) => ({ conversacion_id: conversacionId, profile_id })),
    { onConflict: "conversacion_id,profile_id", ignoreDuplicates: true }
  );
  if (miembrosErr) return NextResponse.json({ error: miembrosErr.message }, { status: 400 });

  return NextResponse.json({ ok: true, conversacionId, nombre: existente?.nombre ?? nombre, reutilizado: !!existente });
}
