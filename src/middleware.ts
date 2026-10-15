import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // api/reportes queda afuera: son endpoints públicos con su propio token
  // (ej. el CSV que levanta Google Sheets con IMPORTDATA), no usan sesión.
  // sw.js y worker-*.js (service worker de next-pwa, con los handlers de Web
  // Push) también: el navegador los pide SIN pasar por una página primero
  // (navigator.serviceWorker.register/update), así que si el middleware los
  // intercepta y no hay sesión, devuelve un 307 a /login en vez del script —
  // el service worker nunca se instala y el push nunca puede llegar.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|api/reportes|sw\\.js|worker-.*\\.js|workbox-.*\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
