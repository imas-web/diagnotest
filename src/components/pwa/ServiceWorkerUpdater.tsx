"use client";

import { useEffect } from "react";

// Mínimo entre recargas forzadas por SW nuevo, guardado en sessionStorage
// (sobrevive a la recarga, a diferencia de una variable en memoria). Sin
// esto, varios despliegues seguidos en poco tiempo (como el 15/10) hacían
// que cada recarga "atrapara" el SW del despliegue siguiente y disparara
// OTRA recarga — un bucle que en el celular se ve como que la app queda
// pegada en el splash verde para siempre, sin ningún error ni demora real.
const RELOAD_COOLDOWN_MS = 20_000;

/**
 * Mantiene la PWA siempre actualizada:
 * - Pide al navegador que chequee si hay un service worker nuevo (al cargar,
 *   al volver a la pestaña y cada 60s).
 * - Cuando el SW nuevo toma el control, recarga la página — pero como mucho
 *   una vez cada RELOAD_COOLDOWN_MS, para no entrar en bucle si hay varios
 *   despliegues seguidos.
 */
export function ServiceWorkerUpdater() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      let last = 0;
      try { last = Number(sessionStorage.getItem("sw-reload-at") || "0"); } catch { /* ignorar */ }
      if (Date.now() - last < RELOAD_COOLDOWN_MS) return;
      reloaded = true;
      try { sessionStorage.setItem("sw-reload-at", String(Date.now())); } catch { /* ignorar */ }
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const checkForUpdate = async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return;
        await reg.update();
        // Si ya hay uno esperando, activarlo de inmediato
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      } catch {
        /* sin conexión u otro error: se reintenta luego */
      }
    };

    checkForUpdate();
    const onVisible = () => document.visibilityState === "visible" && checkForUpdate();
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(checkForUpdate, 60_000);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, []);

  return null;
}
