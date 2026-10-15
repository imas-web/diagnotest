import type { User } from "@supabase/supabase-js";

// Cachea el resultado de una verificación YA HECHA (siempre contra el
// servidor real de Auth, nunca confiando en algo que el cliente pueda
// editar) por un ratito corto, para no repetir esa ida y vuelta a Supabase
// en cada navegación de la misma persona. La clave es el contenido textual
// de las cookies de auth (prefijo "sb-"): si cambian — login, logout,
// refresh de token, o alguien intentando manipular la cookie a mano —, la
// clave cambia y automáticamente se vuelve a verificar de verdad. Nunca se
// cachea un resultado sin haberlo verificado primero.
//
// Vive en memoria del proceso: dura mientras la instancia de Vercel esté
// "tibia" (unos minutos de tráfico seguido), no es compartida entre
// instancias ni global — eso es intencional y suficiente para el objetivo
// (bajar cuántas veces por minuto dependemos de que Supabase responda),
// nunca se usa como única fuente de verdad.
const TTL_MS = 30_000;
const MAX_ENTRIES = 500;

type Entry = { user: User | null; at: number };
const cache = new Map<string, Entry>();

export function authCacheKey(cookiesList: { name: string; value: string }[]): string {
  return cookiesList
    .filter((c) => c.name.startsWith("sb-"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => `${c.name}=${c.value}`)
    .join(";");
}

export function getCachedAuthUser(key: string): User | null | undefined {
  if (!key) return undefined;
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.user;
}

export function setCachedAuthUser(key: string, user: User | null): void {
  if (!key) return;
  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { user, at: Date.now() });
}
