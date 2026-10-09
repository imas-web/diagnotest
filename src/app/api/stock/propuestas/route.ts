import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAnthropicClient, CHATBOT_MODEL } from "@/lib/anthropic/client";

const ROLES_PERMITIDOS = ["stock", "dueno", "super_admin"];

// Genera, a demanda (no automático: tiene costo de API), un análisis breve +
// propuestas de mejora a partir de las estadísticas de stock por sector que
// ya calculó el cliente. No persiste nada — se vuelve a generar cada vez
// que se toca el botón, igual que una consulta al chatbot.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!profile || !ROLES_PERMITIDOS.includes(profile.rol)) {
    return NextResponse.json({ error: "No tenés permiso para el módulo de Stock" }, { status: 403 });
  }

  let body: { sectores?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  if (!body.sectores) return NextResponse.json({ error: "Faltan las estadísticas por sector" }, { status: 400 });

  let anthropic;
  try {
    anthropic = createAnthropicClient();
  } catch {
    return NextResponse.json({ error: "El asistente no está configurado (falta ANTHROPIC_API_KEY)" }, { status: 503 });
  }

  const prompt = `Sos un analista de inventario para un laboratorio veterinario (Diagnotest). Te paso las estadísticas de stock por sector: tipos de producto distintos, unidades totales, cuántos artículos ya se contaron a mano, cuántos tienen diferencia contra el sistema, y el % de exactitud del inventario (de lo contado, qué % coincide).

Escribí en español, en texto plano (sin markdown, sin títulos con #), máximo 200 palabras:
1. Un diagnóstico breve de qué sectores están peor y por qué podría estar pasando.
2. Entre 3 y 5 propuestas concretas y accionables, priorizadas de más a menos urgente.

No repitas los números tal cual la tabla — interpretalos.

Datos por sector:
${JSON.stringify(body.sectores, null, 2)}`;

  try {
    const res = await anthropic.messages.create({
      model: CHATBOT_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    const texto = res.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return NextResponse.json({ ok: true, texto });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo generar el análisis" }, { status: 500 });
  }
}
