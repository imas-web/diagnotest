import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { AuthUnknownError } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { withTimeout } from "@/lib/supabase/withTimeout";

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

  // Cada página/ruta crea su propio cliente y llama getUser() por separado.
  // Dos formas conocidas en que esto se cuelga o corta el acceso sin que la
  // sesión sea realmente inválida:
  //  1) Varios requests en simultáneo justo cuando el token está por vencer
  //     intentan refrescarlo con la misma cookie — Supabase rechaza los
  //     demás con un 409 "too many concurrent token refresh requests".
  //  2) El endpoint de auth de Supabase tarda o no responde — sin límite
  //     propio, el request entero queda colgado hasta el timeout duro de
  //     Vercel (300s en una función), lo que se ve como "se cayó todo".
  // Por eso cada intento tiene un timeout corto y se reintenta una sola vez
  // antes de degradar con gracia (nunca tirar la excepción: rompería las
  // ~60 páginas que llaman getUser() esperando solo { data, error }).
  const getUserOriginal = supabase.auth.getUser.bind(supabase.auth);
  supabase.auth.getUser = async (...args: Parameters<typeof getUserOriginal>) => {
    try {
      const res = await withTimeout(getUserOriginal(...args), 6000);
      if (res.error?.status !== 409) return res;
    } catch { /* sigue al reintento de abajo */ }
    await new Promise((r) => setTimeout(r, 200));
    try {
      return await withTimeout(getUserOriginal(...args), 6000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido al obtener el usuario";
      return { data: { user: null }, error: new AuthUnknownError(message, error) };
    }
  };

  return supabase;
}

// El layout del dashboard verifica la sesión, y CADA página de abajo la
// vuelve a verificar por su cuenta — dos viajes a Supabase por cada
// navegación, para lo mismo, multiplicado por toda la gente usando el
// sistema a la vez. React cache() hace que, dentro de UN mismo request,
// todos los que llamen a esta función compartan la misma llamada real (solo
// se ejecuta una vez) en vez de repetirla. Usar esto (en vez de
// supabase.auth.getUser() directo) en el layout y en las páginas de más
// tráfico reduce esa carga a la mitad.
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  return supabase.auth.getUser();
});

// Mismo motivo: el rol del perfil se repite en casi todas las pantallas.
export const getMyProfile = cache(async () => {
  const { data: { user } } = await getAuthUser();
  if (!user) return { user: null, profile: null };
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return { user, profile };
});
