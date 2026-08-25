import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Lee .env.local manualmente
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();

const url = get("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = get("SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const NUEVA_CLAVE = process.argv[2] || "diagnotest";

// 1) Traer perfiles con rol para ubicar al/los super_admin
const { data: profiles, error: pErr } = await admin
  .from("profiles")
  .select("id, rol, activo, nombre, email");
if (pErr) { console.error("Error perfiles:", pErr.message); process.exit(1); }

// 2) Listar usuarios de auth
const { data: list, error: lErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (lErr) { console.error("Error listUsers:", lErr.message); process.exit(1); }

const byId = new Map(list.users.map((u) => [u.id, u]));

console.log("\n=== PERFILES ===");
for (const p of profiles) {
  const u = byId.get(p.id);
  console.log(`${p.rol.padEnd(20)} | activo:${p.activo} | ${u?.email ?? p.email ?? "(sin email auth)"} | conf:${u?.email_confirmed_at ? "si" : "NO"}`);
}

const superAdmins = profiles.filter((p) => p.rol === "super_admin");
if (!superAdmins.length) {
  console.log("\n⚠️ No hay ningún perfil con rol super_admin.");
  process.exit(0);
}

console.log(`\n=== RESETEANDO ${superAdmins.length} super_admin a clave "${NUEVA_CLAVE}" ===`);
for (const sa of superAdmins) {
  const u = byId.get(sa.id);
  const { error } = await admin.auth.admin.updateUserById(sa.id, {
    password: NUEVA_CLAVE,
    email_confirm: true,
  });
  if (error) console.log(`✗ ${u?.email}: ${error.message}`);
  else console.log(`✓ ${u?.email} — clave reseteada y email confirmado`);
}
