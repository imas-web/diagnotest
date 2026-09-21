import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // api/reportes queda afuera: son endpoints públicos con su propio token
  // (ej. el CSV que levanta Google Sheets con IMPORTDATA), no usan sesión.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|api/reportes|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
