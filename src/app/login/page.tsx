"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { landingPathForRole } from "@/lib/utils/roles";
import { withTimeout } from "@/lib/supabase/withTimeout";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    // Si Supabase tarda en responder (lo vimos pasar: el servicio de auth
    // devolviendo 504), sin un límite propio el botón queda girando en
    // "Ingresando…" para siempre, sin aviso ni forma de reintentar.
    let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["data"];
    let authError: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["error"];
    try {
      ({ data, error: authError } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        15000
      ));
    } catch {
      setError("No se pudo conectar. Probá de nuevo en unos segundos.");
      setLoading(false);
      return;
    }

    if (authError || !data.user) {
      setError("Email o contraseña incorrectos");
      setLoading(false);
      return;
    }

    let profile: { rol: string; activo: boolean } | null;
    try {
      ({ data: profile } = await withTimeout(
        supabase.from("profiles").select("rol, activo").eq("id", data.user.id).single(),
        15000
      ));
    } catch {
      setError("No se pudo conectar. Probá de nuevo en unos segundos.");
      setLoading(false);
      return;
    }

    if (!profile?.activo) {
      setError("Tu cuenta está desactivada. Contactá al administrador.");
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    // Cada rol aterriza en su propia página (el Dashboard es solo de dirección).
    // Navegación "dura" (no router.replace): fuerza al servidor a renderizar
    // el layout con el usuario recién logueado. Con router.replace, Next reutiliza
    // el layout cacheado del usuario anterior y se veía el módulo equivocado hasta
    // recargar la página.
    window.location.assign(landingPathForRole(profile.rol));
  }

  return (
    <div className="min-h-screen bg-g800 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="bg-white rounded-2xl px-6 py-4 shadow-xl">
            <Image src="/logo.png" alt="Diagnotest" width={220} height={72} className="object-contain" priority />
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-gy900 mb-1">Iniciar sesión</h2>
          <p className="text-[12px] text-gy400 mb-6">Ingresá con tus credenciales asignadas</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-gy600 mb-1.5 uppercase tracking-wide">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2.5 border-2 border-gy200 rounded-[6px] text-[13px] bg-gy50 focus:outline-none focus:border-g500 focus:bg-white transition-colors"
                placeholder="nombre@diagnotest.com"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gy600 mb-1.5 uppercase tracking-wide">
                Contraseña
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 pr-10 border-2 border-gy200 rounded-[6px] text-[13px] bg-gy50 focus:outline-none focus:border-g500 focus:bg-white transition-colors"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gy400 hover:text-g600 transition-colors"
                  title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.585 10.587a2 2 0 0 0 2.829 2.828" />
                      <path d="M16.681 16.673A8.717 8.717 0 0 1 12 18c-3.6 0-6.6-2-9-6 1.272-2.12 2.712-3.678 4.32-4.674m2.86-1.146A9.055 9.055 0 0 1 12 6c3.6 0 6.6 2 9 6-.666 1.11-1.379 2.067-2.138 2.87" />
                      <path d="M3 3l18 18" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
                      <path d="M21 12c-2.4 4-5.4 6-9 6c-3.6 0-6.6-2-9-6c2.4-4 5.4-6 9-6c3.6 0 6.6 2 9 6" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-[6px] text-[12px] text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-g800 hover:bg-g700 text-white font-semibold rounded-[10px] text-[14px] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Ingresando…
                </>
              ) : (
                "Ingresar"
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-white/30 mt-6">
          DIAGNOTEST · Plataforma Operativa
        </p>
      </div>
    </div>
  );
}
