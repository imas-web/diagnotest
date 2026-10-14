import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withTimeout } from "@/lib/supabase/withTimeout";
import { revalidarPreanalitica } from "@/lib/preanalitica/revalidar";

// Límite propio para las consultas al cliente admin: sin esto, si la base
// de Supabase responde lenta, el request se cuelga hasta el límite duro de
// Vercel (300s) en vez de fallar rápido con un error que se puede reintentar.
const DB_TIMEOUT = 15000;

const ROLES_PERMITIDOS = ["preanalitica", "super_admin"];
const ESTADOS = ["pendiente", "ok", "observado", "rechazado"];

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  ok: "Controlado OK",
  observado: "Observado",
  rechazado: "Rechazado",
};

async function requireRol() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado", status: 401 as const };
  const { data: profile } = await withTimeout(
    supabase.from("profiles").select("rol").eq("id", user.id).single(),
    DB_TIMEOUT
  );
  if (!profile || !ROLES_PERMITIDOS.includes(profile.rol)) {
    return { error: "No tenés permiso para controlar preanalítica", status: 403 as const };
  }
  return { user };
}

export async function POST(req: Request) {
  try {
    const guard = await requireRol();
    if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

    let body: {
      controlId?: string; estado?: string; control1?: string; control2?: string;
      etiquetas?: string[]; detalle?: string; detalle2?: string;
      responsable1?: string | null; responsable2?: string | null;
    };
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

    const controlId = body.controlId;
    const estado = body.estado ?? "";
    const detalle = (body.detalle ?? "").trim() || null;
    const detalle2 = (body.detalle2 ?? "").trim() || null;
    const responsable1 = (body.responsable1 ?? "")?.toString().trim() || null;
    const responsable2 = (body.responsable2 ?? "")?.toString().trim() || null;
    const control1 = body.control1 ?? null;
    const control2 = body.control2 ?? null;
    const etiquetas = Array.isArray(body.etiquetas) ? body.etiquetas : [];
    if (!controlId) return NextResponse.json({ error: "Falta el control" }, { status: 400 });
    if (!ESTADOS.includes(estado)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });

    const admin = createAdminClient();

    const { data: prev, error: prevErr } = await withTimeout(
      admin.from("control_preanalitica").select("id, retiro_id, estado").eq("id", controlId).single(),
      DB_TIMEOUT
    );
    if (prevErr || !prev) return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });

    const { error: updErr } = await withTimeout(
      admin
        .from("control_preanalitica")
        .update({
          estado,
          control_1: control1,
          control_2: control2,
          etiquetas,
          detalle,
          detalle_2: detalle2,
          responsable_1: responsable1,
          responsable_2: responsable2,
          responsable_id: guard.user.id,
        })
        .eq("id", controlId),
      DB_TIMEOUT
    );
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

    const partes: string[] = [ESTADO_LABEL[estado] ?? estado];
    if (etiquetas.length) partes.push(`etiquetas: ${etiquetas.join(", ")}`);
    if (detalle) partes.push(`obs: ${detalle}`);

    const { error: audErr } = await withTimeout(
      admin.from("auditoria").insert({
        entidad: "preanalitica",
        entidad_id: prev.retiro_id,
        accion: "Control",
        campo_modificado: "estado",
        valor_anterior: ESTADO_LABEL[prev.estado] ?? prev.estado,
        valor_nuevo: partes.join(" · "),
        usuario_id: guard.user.id,
      }),
      DB_TIMEOUT
    );
    if (audErr) return NextResponse.json({ error: audErr.message }, { status: 400 });

    revalidarPreanalitica();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ error: `No se pudo guardar, probá de nuevo (${message})` }, { status: 504 });
  }
}
