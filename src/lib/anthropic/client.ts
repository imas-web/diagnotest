import Anthropic from "@anthropic-ai/sdk";

/**
 * Cliente de Anthropic para el servidor. Solo debe usarse en route handlers.
 * Toma la credencial de ANTHROPIC_API_KEY.
 */
export function createAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Falta ANTHROPIC_API_KEY en el entorno");
  }
  return new Anthropic();
}

export const CHATBOT_MODEL = "claude-sonnet-5";
