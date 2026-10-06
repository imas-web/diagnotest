// Worker custom que next-pwa suma al service worker generado (ver
// customWorkerDir en next.config.js) — acá va SOLO lo que Workbox no genera
// solo: recibir un push y mostrar la notificación, y abrir/enfocar el chat
// al tocarla. El resto (precache, runtimeCaching) lo sigue armando next-pwa
// como siempre.

self.addEventListener("push", (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = { title: "Diagnotest", body: event.data ? event.data.text() : "" };
  }

  const titulo = datos.title || "Diagnotest";
  const opciones = {
    body: datos.body || "",
    icon: datos.icon || "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: datos.tag || "chat-mensaje",
    data: { url: datos.url || "/chat" },
  };

  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

// Al tocar la notificación: si ya hay una pestaña de la plataforma abierta,
// la enfoca y navega ahí; si no, abre una nueva.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/chat";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      for (const cliente of lista) {
        if ("focus" in cliente) {
          cliente.focus();
          if ("navigate" in cliente) cliente.navigate(url);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
