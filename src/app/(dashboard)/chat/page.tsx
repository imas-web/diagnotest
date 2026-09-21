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

  // Con el cliente admin a propósito en las dos: la política de SELECT de
  // profiles no deja leer perfiles ajenos a cualquier rol (solo a algunos,
  // ej. super_admin) — con el cliente de sesión, alguien sin ese permiso
  // veía sus conversaciones pero sin el nombre de la otra persona
  // (chat_miembros→profiles quedaba en null) y "Nuevo mensaje" solo
  // mostraba Grupos, nunca Personas. El service role no pasa por RLS, así
  // que acá se arma a mano el mismo filtro "mías + General" que antes
  // resolvía la política de SELECT de chat_conversaciones.
  const { data: misMiembros } = await admin.from("chat_miembros").select("conversacion_id").eq("profile_id", user.id);
  const idsPropios = (misMiembros ?? []).map((m) => m.conversacion_id);
  const orConversaciones = idsPropios.length
    ? `tipo.eq.general,id.in.(${idsPropios.join(",")})`
    : "tipo.eq.general";

  const [{ data: conversaciones }, { data: contactos, error: errorContactos }] = await Promise.all([
    admin
      .from("chat_conversaciones")
      .select(SELECT_CONVERSACIONES)
      .or(orConversaciones)
      .order("created_at", { ascending: true }),
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
