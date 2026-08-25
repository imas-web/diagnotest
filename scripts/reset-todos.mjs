import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();

const admin = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const NUEVA_CLAVE = process.argv[2] || "diagnotest";

const { data: list, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (error) { console.error("Error listUsers:", error.message); process.exit(1); }

console.log(`Reseteando ${list.users.length} usuarios a clave "${NUEVA_CLAVE}"...\n`);
let ok = 0, fail = 0;
for (const u of list.users) {
  const { error: e } = await admin.auth.admin.updateUserById(u.id, { password: NUEVA_CLAVE, email_confirm: true });
  if (e) { console.log(`✗ ${u.email}: ${e.message}`); fail++; }
  else { ok++; }
}
console.log(`\n✓ ${ok} reseteados · ✗ ${fail} con error`);
