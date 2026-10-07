import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

// Carga el conteo físico ("lo que realmente hay en el depósito") de UN
// artículo. Queda guardado en stock_articulos.stock_real (para comparar
// contra stock_sistema) y además como movimiento en stock_movimientos
// (histórico de quién contó qué y cuándo).
export async function POST(req: Request) {
  const guard = await requireRol();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: { articuloId?: string; stockReal?: number; comentario?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const articuloId = body.articuloId;
  const stockReal = Number(body.stockReal);
  const comentario = (body.comentario ?? "").toString().trim() || null;
  if (!articuloId) return NextResponse.json({ error: "Falta el artículo" }, { status: 400 });
  if (!isFinite(stockReal) || stockReal < 0) return NextResponse.json({ error: "Stock real inválido" }, { status: 400 });

  const admin = createAdminClient();
  const ahora = new Date().toISOString();

  const { error: updErr } = await admin
    .from("stock_articulos")
    .update({
      stock_real: stockReal,
      stock_real_actualizado_at: ahora,
      stock_real_actualizado_por: guard.user.id,
    })
    .eq("id", articuloId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  const { error: movErr } = await admin.from("stock_movimientos").insert({
    articulo_id: articuloId,
    tipo: "conteo_manual",
    valor: stockReal,
    comentario,
    usuario_id: guard.user.id,
  });
  if (movErr) return NextResponse.json({ error: movErr.message }, { status: 400 });

  revalidatePath("/stock");
  return NextResponse.json({ ok: true });
}
