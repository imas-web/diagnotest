import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { landingPathForRole } from "@/lib/utils/roles";
import { withTimeout } from "@/lib/supabase/withTimeout";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Cada request (página, RSC, API) corre este middleware por separado, cada
  // uno con su propio cliente. Dos formas en que esto puede colgar o cortar
  // el acceso sin que la sesión sea realmente inválida:
  //  1) Varios al mismo tiempo justo cuando el token está por vencer intentan
  //     refrescarlo con la misma cookie — Supabase rechaza los demás con un
  //     409 "too many concurrent token refresh requests".
  //  2) El endpoint de auth de Supabase tarda o no responde — sin límite
  //     propio, CADA request queda colgado hasta los 25s duros de Vercel acá
  //     en middleware, lo que se siente como "se cayó todo el sitio".
  // Por eso cada intento tiene un timeout corto (bien por debajo del límite
  // de 25s) y se reintenta una sola vez antes de dejar pasar el request con
  // las cookies actuales, en vez de redirigir a /login de pura mala suerte.
  async function getUserSinCortar() {
    try {
      const { data } = await withTimeout(supabase.auth.getUser(), 5000);
      return data.user;
    } catch {
      try {
        const { data } = await withTimeout(supabase.auth.getUser(), 5000);
        return data.user;
      } catch {
        return undefined; // sigue sin responder: se deja pasar más abajo
      }
    }
  }
  const user = await getUserSinCortar();
  if (user === undefined) return supabaseResponse;

  const { pathname } = request.nextUrl;

  if (!user && !pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    // Cada rol aterriza en su propia página (el Dashboard es solo de dirección).
    try {
      const { data: profile } = await withTimeout(
        supabase.from("profiles").select("rol").eq("id", user.id).single(),
        5000
      );
      const url = request.nextUrl.clone();
      url.pathname = landingPathForRole(profile?.rol);
      return NextResponse.redirect(url);
    } catch {
      return supabaseResponse; // no se pudo resolver el rol a tiempo: se deja en /login
    }
  }

  return supabaseResponse;
}
