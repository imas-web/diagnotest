// Avisos en el dispositivo del cadete cuando llega un pedido nuevo.
// Funciona mientras la app esté abierta (PWA/navegador). El push en segundo
// plano real requiere VAPID + service worker push, que no está configurado.

// Pide permiso de notificaciones una sola vez (best-effort, sin romper si no existe).
export function pedirPermisoNotificaciones() {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  } catch {
    /* navegador sin soporte */
  }
}

// Vibra el teléfono (si lo soporta).
function vibrar() {
  try {
    navigator.vibrate?.([250, 120, 250]);
  } catch {
    /* sin vibración */
  }
}

// Reproduce un beep corto con Web Audio (sin assets). Requiere que el usuario
// ya haya interactuado con la página, cosa que ocurre al usar la app.
function sonar() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const tono = (freq: number, inicio: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + inicio;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.start(t);
      osc.stop(t + dur);
    };
    // Dos tonos ascendentes tipo "ding-dong".
    tono(880, 0, 0.25);
    tono(1175, 0.2, 0.3);
    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch {
    /* sin audio */
  }
}

// Notificación del sistema (si el usuario dio permiso).
function notificacionSistema() {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification("Nuevo pedido de retiro", {
      body: "El jefe te asignó un pedido. Tocá para verlo.",
      icon: "/icons/icon-192.png",
      tag: "pedido-nuevo",
    });
  } catch {
    /* sin notificación */
  }
}

export function notificarNuevoPedido() {
  vibrar();
  sonar();
  notificacionSistema();
}

// Aviso de mensaje nuevo en el chat interno — mismo mecanismo (vibrar +
// sonido + notificación del sistema), pero solo funciona con la pestaña/app
// abierta (ver aclaración arriba). "tag" fijo: un mensaje nuevo reemplaza al
// aviso anterior en vez de apilarlos.
export function notificarMensajeChat(remitente: string, preview: string) {
  vibrar();
  sonar();
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(remitente, {
      body: preview,
      icon: "/icons/icon-192.png",
      tag: "chat-mensaje",
    });
  } catch {
    /* sin notificación */
  }
}
