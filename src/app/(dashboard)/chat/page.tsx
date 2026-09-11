import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Topbar } from "@/components/layout/Topbar";
import { ChatApp } from "@/components/chat/ChatApp";
import { landingPathForRole } from "@/lib/utils/roles";
import { SELECT_CONVERSACIONES } from "@/components/chat/chatShared";

// Los cadetes de logística tienen su propia UI mobile y no forman parte de
// esta primera etapa del chat interno (DiagnoLis).
export default async function ChatPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("id, nombre, email, rol").eq("id", user.id).single();
  if (!me || me.rol === "personal_logistica") redirect(landingPathForRole(me?.rol));

  const admin = createAdminClient();

  const [{ data: conversaciones }, { data: contactos, error: errorContactos }] = await Promise.all([
    supabase
      .from("chat_conversaciones")
      .select(SELECT_CONVERSACIONES)
      .order("created_at", { ascending: true }),
    // Con el cliente admin a propósito: la política de SELECT de profiles
    // no deja leer perfiles ajenos a cualquier rol (solo a algunos, ej.
    // super_admin), así que con el cliente de sesión esto se quedaba sin
    // resultados para el resto — el síntoma era "Nuevo mensaje" mostrando
    // solo Grupos (que ya se resolvía con admin) y nunca Personas.
    admin
      .from("profiles")
      .select("id, nombre, email, rol")
      .neq("id", user.id)
      .neq("rol", "personal_logistica")
      .eq("activo", true)
      .order("nombre"),
  ]);

  const conversacionIds = (conversaciones ?? []).map((c) => c.id);
  // Últimos 200 mensajes de todas las conversaciones: alcanza de sobra para
  // mostrar la vista previa (el último mensaje) de cada una en la lista.
  const { data: ultimosMensajes } = conversacionIds.length
    ? await supabase
        .from("chat_mensajes")
        .select("conversacion_id, contenido, adjunto_tipo, remitente_id, created_at")
        .in("conversacion_id", conversacionIds)
        .order("created_at", { ascending: false })
        .limit(200)
    : { data: [] };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Topbar title="Chat" />
      <ChatApp
        me={me}
        conversacionesIniciales={conversaciones ?? []}
        contactos={contactos ?? []}
        ultimosMensajes={ultimosMensajes ?? []}
        errorContactos={errorContactos?.message ?? null}
      />
    </div>
  );
}
