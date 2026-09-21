// Avisos en el dispositivo del cadete cuando llega un pedido nuevo.
// Funciona mientras la app esté abierta (PWA/navegador). El push en segundo
// plano real requiere VAPID + service worker push, que no está configurado.

export type EstadoNotificaciones = "granted" | "denied" | "default" | "unsupported";

// Solo lee el estado actual, sin pedir permiso (no dispara nada, se puede
// llamar sin gesto del usuario) — para avisar de entrada si ya está
// bloqueado, sin esperar a que alguien haga click en algo.
export function estadoNotificaciones(): EstadoNotificaciones {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

// Pide permiso de notificaciones si todavía no se preguntó, y devuelve el
// estado resultante — "denied" puede significar que el usuario lo rechazó
// hace rato (de antes de pedirlo con un click) y el navegador no vuelve a
// preguntar solo: hay que avisarle que lo habilite a mano desde la config
// del sitio.
export async function pedirPermisoNotificaciones(): Promise<EstadoNotificaciones> {
  try {
    if (typeof Notification === "undefined") return "unsupported";
    if (Notification.permission === "default") {
      const res = await Notification.requestPermission();
      return res;
    }
    return Notification.permission;
  } catch {
    return "unsupported";
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
