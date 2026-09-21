import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnthropicClient, CHATBOT_MODEL } from "@/lib/anthropic/client";
import { buildChatbotTools } from "@/lib/anthropic/chatbotTools";
import { dateISOInBA } from "@/lib/utils/dates";

const ROLES_SIN_ACCESO = ["personal_logistica"];
const MAX_HISTORIAL = 12;

const SYSTEM_PROMPT = `Sos el asistente de consultas de Diagnotest, un laboratorio veterinario. Respondés preguntas sobre la operación (retiros, controles de preanalítica, cobranzas, pedidos, gastos) usando las herramientas disponibles para consultar la base de datos.

Reglas:
- Hoy es ${dateISOInBA()} (zona horaria de Buenos Aires). Interpretá "hoy", "ayer", "esta semana" en base a esa fecha.
- Solo podés CONSULTAR datos, nunca proponer ni ejecutar acciones (no podés cargar, editar, autorizar ni anular nada). Si te piden hacer algo que no sea una consulta, explicá que solo respondés preguntas y sugerí dónde hacerlo en la app.
- Si una pregunta menciona un nombre propio (de personal o de quien controló), usá las herramientas de búsqueda con ese nombre parcial; no asumas apellidos ni corrijas el nombre.
- Si una herramienta no encuentra resultados, decilo con claridad en vez de inventar datos.
- Respondé en español, de forma breve y directa, citando los datos concretos (fechas, nombres, montos) que encontraste.
- Si la pregunta es ambigua (por ejemplo, no aclara la fecha), pedí la aclaración en vez de adivinar.`;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("rol")
    .eq("id", user.id)
    .single();

  if (!profile || ROLES_SIN_ACCESO.includes(profile.rol)) {
    return NextResponse.json({ error: "No tenés acceso al asistente" }, { status: 403 });
  }

  let body: { messages?: { role: "user" | "assistant"; content: string }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const historial = Array.isArray(body.messages) ? body.messages.slice(-MAX_HISTORIAL) : [];
  if (historial.length === 0 || historial[historial.length - 1].role !== "user") {
    return NextResponse.json({ error: "Falta la pregunta" }, { status: 400 });
  }

  let anthropic;
  try {
    anthropic = createAnthropicClient();
  } catch {
    return NextResponse.json(
      { error: "El asistente no está configurado (falta ANTHROPIC_API_KEY)" },
      { status: 503 }
    );
  }

  // Con el cliente admin a propósito: antes armaba las consultas con el
  // cliente de sesión (respetando RLS), así que un rol sin acceso
  // operativo directo (ej. "chat", pensado solo para el chat interno)
  // preguntándole a DiagnoLis por retiros/veterinarias/cadetes se quedaba
  // sin resultados aunque la pregunta fuera válida. A pedido, el asistente
  // queda igual para cualquier rol con acceso al chat (el gate de arriba
  // ya lo controla), aunque esas pantallas les sigan bloqueadas en el menú.
  const admin = createAdminClient();
  const tools = buildChatbotTools(admin);

  try {
    const finalMessage = await anthropic.beta.messages.toolRunner({
      model: CHATBOT_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools,
      messages: historial.map((m) => ({ role: m.role, content: m.content })),
    });

    const texto = finalMessage.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return NextResponse.json({ answer: texto || "No pude generar una respuesta." });
  } catch (err) {
    console.error("Error en /api/chatbot:", err);
    return NextResponse.json({ error: "Error al consultar el asistente" }, { status: 500 });
  }
}
