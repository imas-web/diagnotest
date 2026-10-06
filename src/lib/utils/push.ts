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

// Se llama junto con el pedido de permiso de notificaciones (mismo gesto de
// click). No hace nada si el navegador no soporta push o falta la VAPID key
// pública — en ese caso sigue funcionando el aviso in-page como antes.
export async function suscribirPush(): Promise<void> {
  try {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission !== "granted") return;

    const registro = await navigator.serviceWorker.ready;
    let sub = await registro.pushManager.getSubscription();
    if (!sub) {
      sub = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
    }

    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

    await fetch("/api/push/suscribir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }),
    });
  } catch {
    /* sin push real — queda el aviso in-page como respaldo */
  }
}
