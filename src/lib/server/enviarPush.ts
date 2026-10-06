import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

let configurado = false;
function asegurarVapid() {
  if (configurado) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configurado = true;
  return true;
}

// Manda un push real (Web Push / VAPID) a todos los miembros reales de una
// conversación, menos quien mandó el mensaje — "real" en el sentido de
// chat_miembros, nunca a alguien que solo esté viendo un grupo ajeno para
// mandarle un mensaje de difusión (ver la ruta de grupos). Para "general"
// (sin filas en chat_miembros) se manda a todo el roster con acceso al chat.
// Best-effort: no tira error si falla, y limpia las suscripciones que el
// navegador del destinatario ya dio de baja (410/404).
export async function enviarPushConversacion(params: {
  conversacionId: string;
  tipo: "dm" | "grupo" | "general";
  remitenteId: string;
  titulo: string;
  cuerpo: string;
}) {
  if (!asegurarVapid()) { console.warn("[push] VAPID no configurado, se omite el envío"); return; }
  const admin = createAdminClient();

  let destinatarios: string[] = [];
  if (params.tipo === "general") {
    const { data } = await admin
      .from("profiles").select("id")
      .neq("id", params.remitenteId).neq("rol", "personal_logistica").eq("activo", true);
    destinatarios = (data ?? []).map((p) => p.id);
  } else {
    const { data } = await admin
      .from("chat_miembros").select("profile_id")
      .eq("conversacion_id", params.conversacionId).neq("profile_id", params.remitenteId);
    destinatarios = (data ?? []).map((m) => m.profile_id);
  }
  console.log("[push] destinatarios reales:", destinatarios.length, params.conversacionId);
  if (!destinatarios.length) return;

  const { data: subs } = await admin
    .from("push_subscriptions").select("id, endpoint, p256dh, auth")
    .in("profile_id", destinatarios);
  console.log("[push] suscripciones encontradas:", subs?.length ?? 0);
  if (!subs?.length) return;

  const payload = JSON.stringify({ title: params.titulo, body: params.cuerpo, url: "/chat", tag: "chat-mensaje" });
  const idsParaBorrar: string[] = [];
  let enviados = 0;

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      );
      enviados++;
    } catch (err) {
      // 404/410 = el navegador dio de baja esa suscripción (cambió de
      // perfil, desinstaló, etc.) — se limpia para no reintentar siempre.
      const status = (err as { statusCode?: number })?.statusCode;
      console.error("[push] sendNotification falló", status, (err as Error)?.message);
      if (status === 404 || status === 410) idsParaBorrar.push(s.id);
    }
  }));
  console.log(`[push] enviados OK: ${enviados}/${subs.length}`);

  if (idsParaBorrar.length) {
    await admin.from("push_subscriptions").delete().in("id", idsParaBorrar);
  }
}
