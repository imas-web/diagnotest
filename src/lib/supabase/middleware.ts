import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { landingPathForRole } from "@/lib/utils/roles";

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
  // uno con su propio cliente — si el navegador dispara varios al mismo
  // tiempo justo cuando el token está por vencer, más de uno intenta
  // refrescarlo con la misma cookie y Supabase rechaza los demás con un 409
  // "too many concurrent token refresh requests". Eso no significa que la
  // sesión sea inválida (otro request en paralelo sí la está refrescando),
  // así que no hay que tratarlo como "no hay usuario" ni cortar el request:
  // se reintenta una vez y, si persiste, se deja pasar con las cookies
  // actuales — la próxima página ya va a tener el token renovado.
  async function getUserSinCortar() {
    try {
      const { data } = await supabase.auth.getUser();
      return data.user;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const { data } = await supabase.auth.getUser();
        return data.user;
      } catch {
        return undefined; // sigue en conflicto: se deja pasar más abajo
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
    const { data: profile } = await supabase
      .from("profiles")
      .select("rol")
      .eq("id", user.id)
      .single();
    const url = request.nextUrl.clone();
    url.pathname = landingPathForRole(profile?.rol);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
