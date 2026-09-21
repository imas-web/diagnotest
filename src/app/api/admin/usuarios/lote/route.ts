import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ROLES_VALIDOS = [
  "personal_logistica", "jefe_logistica", "preanalitica", "cobranzas",
  "carga", "dueno", "super_admin", "chat",
] as const;
type Rol = (typeof ROLES_VALIDOS)[number];

function generarPassword(): string {
  // Sin caracteres ambiguos (0/O, 1/l/I) para que se puedan dictar/copiar sin error.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

interface FilaLote {
  nombre: string;
  email: string;
  rol: string;
  grupo?: string | null;
  yaExiste?: boolean;
}

// Alta en lote de usuarios (para el roster completo de DiagnoLis) + alta
// automática de canales de sector y su membresía. Reservado a super_admin,
// igual que el alta individual en /api/admin/usuarios.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (profile?.rol !== "super_admin") {
    return NextResponse.json({ error: "Solo el super administrador puede hacer esto" }, { status: 403 });
  }

  let body: { filas?: FilaLote[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const filas = body.filas ?? [];
  if (!filas.length) return NextResponse.json({ error: "Nada para crear" }, { status: 400 });

  const admin = createAdminClient();
  const resultados: { email: string; nombre: string; ok: boolean; password?: string; error?: string; yaExiste?: boolean }[] = [];
  const idPorEmail = new Map<string, string>();

  // 1) Crear (o localizar) cada cuenta.
  for (const fila of filas) {
    const email = fila.email.trim().toLowerCase();
    const nombre = fila.nombre.trim();

    if (!ROLES_VALIDOS.includes(fila.rol as Rol)) {
      resultados.push({ email, nombre, ok: false, error: "Rol inválido" });
      continue;
    }

    if (fila.yaExiste) {
      const { data: existente } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
      if (existente) {
        idPorEmail.set(email, existente.id);
        resultados.push({ email, nombre, ok: true, yaExiste: true });
      } else {
        resultados.push({ email, nombre, ok: false, error: "Marcado como \"ya existe\" pero no se encontró en el sistema" });
      }
      continue;
    }

    const password = generarPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { nombre, rol: fila.rol },
    });

    if (error) {
      const yaRegistrado = /already.*registered|exists/i.test(error.message);
      if (yaRegistrado) {
        const { data: existente } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
        if (existente) {
          idPorEmail.set(email, existente.id);
          resultados.push({ email, nombre, ok: true, yaExiste: true });
          continue;
        }
      }
      resultados.push({ email, nombre, ok: false, error: yaRegistrado ? "Ya existe un usuario con ese email" : error.message });
      continue;
    }

    if (data.user?.id) idPorEmail.set(email, data.user.id);
    resultados.push({ email, nombre, ok: true, password });
  }

  // 2) Canales de sector usados en esta tanda: crear el que falte y sumar
  //    a cada persona (cuentas nuevas y las que ya existían) como miembro.
  const grupos = Array.from(new Set(filas.map((f) => f.grupo).filter((g): g is string => !!g)));
  const idCanalPorGrupo = new Map<string, string>();
  for (const grupo of grupos) {
    const { data: existente } = await admin
      .from("chat_conversaciones").select("id").eq("tipo", "grupo").eq("nombre", grupo).maybeSingle();
    if (existente) { idCanalPorGrupo.set(grupo, existente.id); continue; }
    const { data: nuevo } = await admin
      .from("chat_conversaciones").insert({ tipo: "grupo", nombre: grupo }).select("id").single();
    if (nuevo) idCanalPorGrupo.set(grupo, nuevo.id);
  }

  for (const fila of filas) {
    if (!fila.grupo) continue;
    const profileId = idPorEmail.get(fila.email.trim().toLowerCase());
    const canalId = idCanalPorGrupo.get(fila.grupo);
    if (!profileId || !canalId) continue;
    await admin.from("chat_miembros").upsert(
      { conversacion_id: canalId, profile_id: profileId },
      { onConflict: "conversacion_id,profile_id" }
    );
  }

  return NextResponse.json({ ok: true, resultados });
}
