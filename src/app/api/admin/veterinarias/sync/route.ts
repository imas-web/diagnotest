import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Sincronizaciones grandes (miles de filas) necesitan más margen que el default.
export const maxDuration = 60;

// ── Helpers ─────────────────────────────────────────────────
async function requireSuperAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado", status: 401 as const };
  const { data: profile } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (profile?.rol !== "super_admin") return { error: "Solo el super administrador puede sincronizar", status: 403 as const };
  return { user };
}

// Convierte un link de Google Sheets a una lista de URLs de exportación CSV
// para probar en orden. Clave: NO forzar gid=0 (Google devuelve 400 si ese tab
// no existe). Sin gid en el link, se pide la primera hoja por defecto.
function sheetCsvCandidates(input: string): string[] | null {
  const url = input.trim();
  // Ya es un link CSV directo (export o publicado): se usa tal cual.
  if (/output=csv|format=csv|tqx=out:csv/i.test(url)) return [url];
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;
  const base = `https://docs.google.com/spreadsheets/d/${idMatch[1]}`;
  const gidMatch = url.match(/[#&?]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : null;

  const cands: string[] = [];
  // Si el link trae gid, se intenta esa hoja puntual primero.
  if (gid) cands.push(`${base}/export?format=csv&gid=${gid}`);
  // Primera hoja por defecto (cubre el caso del gid real distinto de 0).
  cands.push(`${base}/export?format=csv`);
  // Último recurso: la API de visualización (otra ruta de exportación CSV).
  cands.push(`${base}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ""}`);
  return cands;
}

// Parser CSV mínimo que respeta comillas y comas internas.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* ignorar */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

interface ResultRow { codigo: string; nombre: string; estado: "creado" | "actualizado" | "error"; detalle?: string }

// ── POST: sincronizar veterinarias desde el Sheet ───────────
export async function POST(req: Request) {
  const guard = await requireSuperAdmin();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: { sheetUrl?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const candidatos = sheetCsvCandidates(body.sheetUrl ?? "");
  if (!candidatos) return NextResponse.json({ error: "El link no parece un Google Sheet válido" }, { status: 400 });

  // 1) Descargar el CSV probando las rutas de exportación en orden. Si una da
  //    404/400 (por ej. gid inexistente) se prueba la siguiente.
  let csvText: string | null = null;
  let ultimoStatus = 0;
  for (const csvUrl of candidatos) {
    try {
      const resp = await fetch(csvUrl, {
        redirect: "follow",
        cache: "no-store",
        headers: {
          // Google puede rechazar o devolver HTML si no hay un User-Agent de navegador.
          "User-Agent": "Mozilla/5.0 (compatible; DiagnotestBot/1.0)",
          "Accept": "text/csv,text/plain,*/*",
        },
      });

      // Si terminó en una pantalla de login/permisos de Google → el Sheet no es público.
      if (/accounts\.google\.com|ServiceLogin/i.test(resp.url)) {
        return NextResponse.json({ error: "El Sheet no es público. Compartilo como 'Cualquiera con el enlace puede ver' e intentá de nuevo." }, { status: 400 });
      }
      if (!resp.ok) { ultimoStatus = resp.status; continue; }

      const text = await resp.text();
      if (/<html|<!doctype html/i.test(text)) { ultimoStatus = 200; continue; }
      csvText = text;
      break;
    } catch {
      ultimoStatus = -1;
    }
  }

  if (csvText == null) {
    const detalle = ultimoStatus === 404
      ? "El Sheet no existe o el link es incorrecto (404)."
      : ultimoStatus === 401 || ultimoStatus === 403
        ? "Sin permisos para acceder al Sheet. Compartilo como 'Cualquiera con el enlace puede ver'."
        : "No se pudo descargar el Sheet. Verificá que esté como 'Cualquiera con el enlace puede ver' y que el link apunte a la hoja correcta.";
    return NextResponse.json({ error: detalle }, { status: 400 });
  }

  // 2) Parsear y mapear columnas por encabezado
  const rows = parseCsv(csvText).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return NextResponse.json({ error: "El Sheet no tiene filas de datos" }, { status: 400 });

  const headers = rows[0].map(norm);
  const colCodigo = headers.findIndex((h) => ["codigo", "código", "cod", "code"].includes(h));
  const colNombre = headers.findIndex((h) => ["nombre", "veterinaria", "nombre veterinaria"].includes(h));
  const colDireccion = headers.findIndex((h) => ["direccion", "dirección", "domicilio"].includes(h));
  const colTelefono = headers.findIndex((h) => ["telefono", "teléfono", "tel", "celular", "contacto"].includes(h));
  const colEmail = headers.findIndex((h) => ["email", "e-mail", "mail", "correo"].includes(h));
  const colLocalidad = headers.findIndex((h) => ["localidad", "barrio", "partido"].includes(h));
  const colZona = headers.findIndex((h) => ["zona", "zona base", "zona_base"].includes(h));

  if (colCodigo === -1 || colNombre === -1) {
    return NextResponse.json({ error: "El Sheet debe tener al menos las columnas 'codigo' y 'nombre' en la primera fila" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Zonas: nombre→id, y mapa localidad→zonaId (lo arma el jefe de logística).
  const { data: zonas } = await admin.from("zonas").select("id, nombre, localidades");
  const zonaByName = new Map((zonas ?? []).map((z) => [norm(z.nombre), z.id]));
  const zonaByLocalidad = new Map<string, string>();
  const barriosCABA: string[] = [];
  for (const z of zonas ?? []) {
    const esCABA = norm(z.nombre).startsWith("caba");
    for (const loc of (z.localidades as string[] | null) ?? []) {
      const key = norm(loc);
      if (!key) continue;
      if (!zonaByLocalidad.has(key)) zonaByLocalidad.set(key, z.id);
      if (esCABA) barriosCABA.push(key);
    }
  }
  // Barrios más largos primero, para evitar matches parciales (ej. "flores" dentro de "floresta").
  barriosCABA.sort((a, b) => b.length - a.length);

  // Deduce la zona a partir de la localidad. Si la localidad es "CABA" (genérica),
  // intenta inferir el barrio desde la dirección (solo barrios de CABA).
  function resolverZona(localidad: string, direccion: string): string | null {
    const locN = norm(localidad);
    if (locN && locN !== "caba" && zonaByLocalidad.has(locN)) return zonaByLocalidad.get(locN)!;
    if (locN === "caba" && direccion) {
      const d = " " + norm(direccion).replace(/[.,]/g, " ").replace(/\s+/g, " ") + " ";
      for (const b of barriosCABA) {
        if (d.includes(" " + b + " ")) return zonaByLocalidad.get(b)!;
      }
    }
    return null;
  }

  // Códigos ya existentes (para clasificar creado vs actualizado). Paginado por el cap de 1000.
  const existentes = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("veterinarias").select("codigo").order("id", { ascending: true }).range(from, from + 999);
    if (error || !data || data.length === 0) break;
    for (const v of data) existentes.add(String(v.codigo));
    if (data.length < 1000) break;
  }

  const results: ResultRow[] = [];
  let conZona = 0;
  type VetPayload = { codigo: string; nombre: string; direccion: string | null; telefono: string | null; email: string | null; localidad: string | null; zona_id: string | null; activa: boolean };
  const payloads: VetPayload[] = [];
  const vistos = new Set<string>(); // evita procesar dos veces el mismo código dentro del Sheet

  for (const r of rows.slice(1)) {
    const codigo = (r[colCodigo] ?? "").trim();
    const nombre = (r[colNombre] ?? "").trim();
    if (!codigo && !nombre) continue;
    if (!codigo || !nombre) {
      results.push({ codigo: codigo || "(sin código)", nombre: nombre || "(sin nombre)", estado: "error", detalle: "Falta código o nombre" });
      continue;
    }
    if (vistos.has(codigo)) {
      results.push({ codigo, nombre, estado: "error", detalle: "Código duplicado dentro del Sheet" });
      continue;
    }
    vistos.add(codigo);

    const direccion = colDireccion !== -1 ? (r[colDireccion] ?? "").trim() || null : null;
    const telefono = colTelefono !== -1 ? (r[colTelefono] ?? "").trim() || null : null;
    const email = colEmail !== -1 ? (r[colEmail] ?? "").trim() || null : null;
    const localidad = colLocalidad !== -1 ? (r[colLocalidad] ?? "").trim() || null : null;

    // Zona: si el Sheet trae columna 'zona' se usa; si no, se deduce de la localidad.
    let zonaId: string | null = null;
    const zonaNombre = colZona !== -1 ? (r[colZona] ?? "").trim() : "";
    if (zonaNombre) {
      const key = norm(zonaNombre);
      if (zonaByName.has(key)) {
        zonaId = zonaByName.get(key) ?? null;
      } else {
        const { data: nz } = await admin.from("zonas").insert({ nombre: zonaNombre, activa: true }).select("id").single();
        if (nz) { zonaId = nz.id; zonaByName.set(key, nz.id); }
      }
    } else {
      zonaId = resolverZona(localidad ?? "", direccion ?? "");
    }
    if (zonaId) conZona++;

    payloads.push({ codigo, nombre, direccion, telefono, email, localidad, zona_id: zonaId, activa: true });
    results.push({ codigo, nombre, estado: existentes.has(codigo) ? "actualizado" : "creado" });
  }

  // Upsert por lotes (codigo es unique) → evita miles de round-trips y el timeout.
  const CHUNK = 500;
  for (let i = 0; i < payloads.length; i += CHUNK) {
    const chunk = payloads.slice(i, i + CHUNK);
    const { error } = await admin.from("veterinarias").upsert(chunk, { onConflict: "codigo" });
    if (error) {
      const codes = new Set(chunk.map((p) => p.codigo));
      for (const res of results) {
        if (codes.has(res.codigo) && res.estado !== "error") { res.estado = "error"; res.detalle = error.message; }
      }
    }
  }

  const creados = results.filter((r) => r.estado === "creado").length;
  const actualizados = results.filter((r) => r.estado === "actualizado").length;
  const errores = results.filter((r) => r.estado === "error").length;

  return NextResponse.json({ ok: true, resumen: { creados, actualizados, errores, total: results.length, conZona }, results });
}
