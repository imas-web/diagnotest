import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
const admin = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SHEET_VETS = "1a6hntP-h89IPcfAAhTjmhiPok5FsAtaJxAH-KdmS2RU";
const SHEET_ZONAS = "1AcB8v2VyYvNR-5lhreSfV--uu7UFTfRulwNt6CGpBo4";
const csvUrl = (id) => `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;

function parseCsv(text) {
  const rows = [];
  let field = "", row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") {}
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
const norm = (s) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const col = (headers, names) => headers.findIndex((h) => names.includes(h));

async function descargar(id) {
  const resp = await fetch(csvUrl(id), { redirect: "follow", cache: "no-store" });
  const text = await resp.text();
  if (/<html/i.test(text)) throw new Error("Sheet no público o inaccesible: " + id);
  return text;
}

// ── 1) ZONAS ────────────────────────────────────────────────
async function cargarZonas() {
  console.log("\n=== ZONAS ===");
  const rows = parseCsv(await descargar(SHEET_ZONAS));
  const headers = rows[0].map(norm);
  const ci = col(headers, ["localidad", "localidades", "barrio", "partido"]);
  const zi = col(headers, ["zona", "zona base", "zona_base"]);
  if (ci === -1 || zi === -1) throw new Error("Sheet de zonas sin columnas localidad/zona");

  const porZona = new Map();
  let sinZona = 0;
  for (const r of rows.slice(1)) {
    const loc = (r[ci] ?? "").trim(), zona = (r[zi] ?? "").trim();
    if (!loc) continue;
    if (!zona) { sinZona++; continue; }
    if (!porZona.has(zona)) porZona.set(zona, new Set());
    porZona.get(zona).add(loc);
  }

  const { data: existentes } = await admin.from("zonas").select("id, nombre");
  const byName = new Map((existentes ?? []).map((z) => [norm(z.nombre), z.id]));

  let creadas = 0, actualizadas = 0;
  for (const [zonaNombre, set] of porZona) {
    const locs = [...set].sort();
    const id = byName.get(norm(zonaNombre));
    if (id) {
      const { error } = await admin.from("zonas").update({ localidades: locs, activa: true }).eq("id", id);
      if (error) console.log(`  ✗ ${zonaNombre}: ${error.message}`); else actualizadas++;
    } else {
      const { error } = await admin.from("zonas").insert({ nombre: zonaNombre, localidades: locs, activa: true });
      if (error) console.log(`  ✗ ${zonaNombre}: ${error.message}`); else creadas++;
    }
  }
  console.log(`  Zonas: ${creadas} creadas, ${actualizadas} actualizadas · ${porZona.size} en total · ${sinZona} filas sin zona`);
}

// ── 2) VETERINARIAS ─────────────────────────────────────────
async function cargarVets() {
  console.log("\n=== VETERINARIAS ===");
  // Mapa localidad→zona desde la tabla zonas (ya cargada)
  const { data: zonas } = await admin.from("zonas").select("id, nombre, localidades");
  const zonaByLocalidad = new Map();
  const barriosCABA = [];
  for (const z of zonas ?? []) {
    const esCABA = norm(z.nombre).startsWith("caba");
    for (const loc of z.localidades ?? []) {
      const k = norm(loc);
      if (!k) continue;
      if (!zonaByLocalidad.has(k)) zonaByLocalidad.set(k, z.id);
      if (esCABA) barriosCABA.push(k);
    }
  }
  barriosCABA.sort((a, b) => b.length - a.length);
  const resolverZona = (localidad, direccion) => {
    const locN = norm(localidad);
    if (locN && locN !== "caba" && zonaByLocalidad.has(locN)) return zonaByLocalidad.get(locN);
    if (locN === "caba" && direccion) {
      const d = " " + norm(direccion).replace(/[.,]/g, " ").replace(/\s+/g, " ") + " ";
      for (const b of barriosCABA) if (d.includes(" " + b + " ")) return zonaByLocalidad.get(b);
    }
    return null;
  };

  const rows = parseCsv(await descargar(SHEET_VETS));
  const headers = rows[0].map(norm);
  const cCod = col(headers, ["codigo", "código", "cod", "code"]);
  const cNom = col(headers, ["nombre", "veterinaria", "nombre veterinaria"]);
  const cDir = col(headers, ["direccion", "dirección", "domicilio"]);
  const cTel = col(headers, ["telefono", "teléfono", "tel", "celular", "contacto"]);
  const cMail = col(headers, ["email", "e-mail", "mail", "correo"]);
  const cLoc = col(headers, ["localidad", "barrio", "partido"]);
  if (cCod === -1 || cNom === -1) throw new Error("Sheet de vets sin columnas codigo/nombre");

  const porCodigo = new Map(); // dedupe: último gana
  let conZona = 0, sinDatos = 0;
  for (const r of rows.slice(1)) {
    const codigo = (r[cCod] ?? "").trim();
    const nombre = (r[cNom] ?? "").trim();
    if (!codigo || !nombre) { if (codigo || nombre) sinDatos++; continue; }
    const direccion = cDir !== -1 ? (r[cDir] ?? "").trim() || null : null;
    const telefono = cTel !== -1 ? (r[cTel] ?? "").trim() || null : null;
    const email = cMail !== -1 ? (r[cMail] ?? "").trim() || null : null;
    const localidad = cLoc !== -1 ? (r[cLoc] ?? "").trim() || null : null;
    const zona_id = resolverZona(localidad ?? "", direccion ?? "");
    porCodigo.set(codigo, { codigo, nombre, direccion, telefono, email, localidad, zona_id, activa: true });
  }
  const payloads = [...porCodigo.values()];
  conZona = payloads.filter((p) => p.zona_id).length;
  console.log(`  Filas válidas: ${payloads.length} (deduplicadas por código) · ${sinDatos} descartadas por falta de código/nombre`);
  console.log(`  Con zona resuelta: ${conZona} · sin zona: ${payloads.length - conZona}`);

  // Upsert por código en lotes
  const chunk = 500;
  let ok = 0;
  for (let i = 0; i < payloads.length; i += chunk) {
    const batch = payloads.slice(i, i + chunk);
    const { error } = await admin.from("veterinarias").upsert(batch, { onConflict: "codigo" });
    if (error) { console.log(`  ✗ lote ${i / chunk + 1}: ${error.message}`); }
    else { ok += batch.length; process.stdout.write(`\r  Subidas: ${ok}/${payloads.length}`); }
  }
  console.log(`\n  ✓ ${ok} veterinarias cargadas/actualizadas`);
}

await cargarZonas();
await cargarVets();
console.log("\nListo.");
