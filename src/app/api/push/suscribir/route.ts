import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Guarda (o actualiza) la suscripción push del navegador de la cuenta
// logueada. Se resuelve con el cliente admin por el mismo motivo que el
// resto de las rutas del chat: evita depender de RLS bajo carga.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: { endpoint?: string; p256dh?: string; auth?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const { endpoint, p256dh, auth } = body;
  if (!endpoint || !p256dh || !auth) return NextResponse.json({ error: "Faltan datos de la suscripción" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("push_subscriptions")
    .upsert({ profile_id: user.id, endpoint, p256dh, auth }, { onConflict: "endpoint" });
  if (error) {
    console.error("[push/suscribir] upsert falló", user.id, error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.log("[push/suscribir] OK", user.id, endpoint.slice(0, 60));
  return NextResponse.json({ ok: true });
}
