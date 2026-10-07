import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esDireccion } from "@/lib/utils/roles";
import { fmtMoneySign } from "@/lib/utils/format";

async function requireDireccion() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado", status: 401 as const };
  const { data: profile } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!esDireccion(profile?.rol)) return { error: "Solo Dirección puede resolver diferencias de caja", status: 403 as const };
  return { user };
}

// Marca (o reabre) una diferencia de rendición de caja como resuelta —
// no cambia el estado ni los montos ya sellados, solo deja constancia de
// que se revisó (ej. "descontado al cadete", "corregido con la veterinaria")
// para que deje de aparecer entre las pendientes de resolver.
export async function POST(req: Request) {
  const guard = await requireDireccion();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: { rendicionId?: string; resuelta?: boolean; nota?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const rendicionId = body.rendicionId;
  const resuelta = !!body.resuelta;
  const nota = (body.nota ?? "").trim() || null;
  if (!rendicionId) return NextResponse.json({ error: "Falta la rendición" }, { status: 400 });

  const admin = createAdminClient();
  const { data: prev, error: prevErr } = await admin
    .from("rendiciones_caja")
    .select("id, estado, personal:personal_id(nombre), fecha_operativa, diferencia")
    .eq("id", rendicionId)
    .single();
  if (prevErr || !prev) return NextResponse.json({ error: "Rendición no encontrada" }, { status: 404 });
  if (prev.estado !== "diferencia") {
    return NextResponse.json({ error: "Esta rendición no tiene una diferencia registrada" }, { status: 400 });
  }

  const { error: updErr } = await admin
    .from("rendiciones_caja")
    .update({
      resuelta,
      resuelta_en: resuelta ? new Date().toISOString() : null,
      resuelta_por: resuelta ? guard.user.id : null,
      nota_resolucion: resuelta ? nota : null,
    })
    .eq("id", rendicionId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  const personal = (Array.isArray(prev.personal) ? prev.personal[0] : prev.personal) as { nombre?: string } | null;
  await admin.from("auditoria").insert({
    entidad: "rendicion_caja",
    entidad_id: rendicionId,
    accion: resuelta ? "Diferencia de caja resuelta" : "Diferencia de caja reabierta",
    campo_modificado: "resuelta",
    valor_anterior: resuelta ? "pendiente" : "resuelta",
    valor_nuevo: resuelta
      ? `${personal?.nombre ?? "—"} · ${prev.fecha_operativa} · dif ${fmtMoneySign(prev.diferencia)}${nota ? ` · ${nota}` : ""}`
      : "reabierta",
    usuario_id: guard.user.id,
  });

  return NextResponse.json({ ok: true });
}
