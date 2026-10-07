import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsearExcelStock } from "@/lib/stock/parseExcel";

const ROLES_PERMITIDOS = ["stock", "dueno", "super_admin"];

async function requireRol() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado", status: 401 as const };
  const { data: profile } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!profile || !ROLES_PERMITIDOS.includes(profile.rol)) {
    return { error: "No tenés permiso para el módulo de Stock", status: 403 as const };
  }
  return { user };
}

export async function POST(req: Request) {
  const guard = await requireRol();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const form = await req.formData().catch(() => null);
  const file = form?.get("archivo");
  if (!file || !(file instanceof File)) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const { filas, errores, tieneCategoria, tieneAlmacen } = parsearExcelStock(buffer);
  if (!filas.length) return NextResponse.json({ error: errores.join(" ") || "Archivo vacío" }, { status: 400 });

  const admin = createAdminClient();
  const codigos = filas.map((f) => f.codigo);

  // No pisar categoria/almacen con null si el excel de este sector no trae
  // esas columnas — se conserva lo que ya había guardado para ese artículo.
  const { data: existentes, error: existErr } = await admin
    .from("stock_articulos")
    .select("codigo, categoria, almacen")
    .in("codigo", codigos);
  if (existErr) return NextResponse.json({ error: existErr.message }, { status: 400 });
  const existenteMap = new Map((existentes ?? []).map((e) => [e.codigo, e]));

  const ahora = new Date().toISOString();
  const filasUpsert = filas.map((f) => {
    const prev = existenteMap.get(f.codigo);
    return {
      codigo: f.codigo,
      nombre: f.nombre,
      categoria: tieneCategoria ? f.categoria : (prev?.categoria ?? null),
      almacen: tieneAlmacen ? f.almacen : (prev?.almacen ?? null),
      stock_minimo: f.stockMinimo,
      stock_sistema: f.stock,
      stock_sistema_actualizado_at: ahora,
    };
  });

  const { error: upsertErr } = await admin.from("stock_articulos").upsert(filasUpsert, { onConflict: "codigo" });
  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 400 });

  const { data: articulos, error: artErr } = await admin
    .from("stock_articulos")
    .select("id, codigo")
    .in("codigo", codigos);
  if (artErr) return NextResponse.json({ error: artErr.message }, { status: 400 });
  const idPorCodigo = new Map((articulos ?? []).map((a) => [a.codigo, a.id]));

  const movimientos = filas
    .map((f) => {
      const articuloId = idPorCodigo.get(f.codigo);
      if (!articuloId) return null;
      return {
        articulo_id: articuloId,
        tipo: "carga_excel" as const,
        valor: f.stock,
        stock_minimo: f.stockMinimo,
        archivo_nombre: file.name,
        usuario_id: guard.user.id,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  const { error: movErr } = await admin.from("stock_movimientos").insert(movimientos);
  if (movErr) return NextResponse.json({ error: movErr.message }, { status: 400 });

  await admin.from("auditoria").insert({
    entidad: "stock",
    entidad_id: file.name || "carga",
    accion: "Carga de excel",
    campo_modificado: "stock_sistema",
    valor_anterior: null,
    valor_nuevo: `${filas.length} artículo(s) actualizados desde "${file.name}"`,
    usuario_id: guard.user.id,
  });

  revalidatePath("/stock");
  return NextResponse.json({
    ok: true,
    actualizados: filas.length,
    avisos: errores.length ? errores : undefined,
  });
}
