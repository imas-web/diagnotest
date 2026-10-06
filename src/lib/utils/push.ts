// Suscripción a notificaciones push reales (Web Push / VAPID): a diferencia
// del aviso in-page de notificaciones.ts, esto lo entrega el navegador/SO
// directamente, incluso con la pestaña minimizada o "congelada" — el caso
// que no se podía cubrir de otra forma (ver conversación del chat interno).

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Normalizado = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(base64Normalizado);
  const salida = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) salida[i] = binario.charCodeAt(i);
  return salida;
}

export type ResultadoPush = "ok" | "sin-soporte" | "sin-vapid" | "sin-permiso" | "error";

// Se llama junto con el pedido de permiso de notificaciones (mismo gesto de
// click). Devuelve en qué quedó (en vez de fallar en silencio como antes) —
// mientras se estabiliza esta función nueva, el que llama puede mostrar un
// toast con el resultado para diagnosticar sin tener que abrir la consola.
export async function suscribirPush(): Promise<ResultadoPush> {
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) { console.warn("[push] falta NEXT_PUBLIC_VAPID_PUBLIC_KEY en el build"); return "sin-vapid"; }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) { console.warn("[push] navegador sin soporte de Push API"); return "sin-soporte"; }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") { console.warn("[push] permiso de notificaciones no concedido"); return "sin-permiso"; }

  try {
    const registro = await navigator.serviceWorker.ready;
    let sub = await registro.pushManager.getSubscription();
    if (!sub) {
      sub = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
    }

    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      console.warn("[push] suscripción sin endpoint/claves", json);
      return "error";
    }

    const res = await fetch("/api/push/suscribir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }),
    });
    if (!res.ok) {
      console.warn("[push] el servidor rechazó la suscripción:", await res.text().catch(() => ""));
      return "error";
    }
    console.info("[push] suscripción guardada OK");
    return "ok";
  } catch (err) {
    console.error("[push] excepción al suscribir", err);
    return "error";
  }
}
