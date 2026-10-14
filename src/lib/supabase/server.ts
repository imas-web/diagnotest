import { createServerClient } from "@supabase/ssr";
import { AuthUnknownError } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );

  // Cada página/ruta crea su propio cliente y, si el navegador dispara varias
  // en simultáneo justo cuando el token está por vencer, más de una intenta
  // refrescarlo con la misma cookie — Supabase rechaza las demás con un 409
  // "too many concurrent token refresh requests" (a veces como error, a
  // veces directamente tirando la excepción). No es que la sesión sea
  // inválida — otro request en paralelo la está refrescando — así que en vez
  // de dejar que las ~60 páginas que llaman getUser() traten esto como
  // "no hay usuario" y corten el acceso, se reintenta acá una sola vez.
  const getUserOriginal = supabase.auth.getUser.bind(supabase.auth);
  supabase.auth.getUser = async (...args: Parameters<typeof getUserOriginal>) => {
    try {
      const res = await getUserOriginal(...args);
      if (res.error?.status !== 409) return res;
    } catch { /* sigue al reintento de abajo */ }
    await new Promise((r) => setTimeout(r, 200));
    try {
      return await getUserOriginal(...args);
    } catch (error) {
      // Seguir en conflicto tras el reintento: no tirar la excepción (eso
      // rompería la página entera) — se devuelve "sin usuario" para que cada
      // pantalla haga su fallback normal (típicamente redirigir a /login).
      const message = error instanceof Error ? error.message : "Error desconocido al obtener el usuario";
      return { data: { user: null }, error: new AuthUnknownError(message, error) };
    }
  };

  return supabase;
}
