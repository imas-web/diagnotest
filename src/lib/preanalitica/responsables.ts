// Nombres habilitados para marcar quién hizo cada control de preanalítica
// (Control 1 / Control 2). No son usuarios del sistema: es una lista fija que
// el operador marca al controlar. "Reemplazo" habilita un texto libre para
// cargar un nombre que no esté en la lista.
export const RESPONSABLES_PREANALITICA = [
  "Santiago",
  "Veronica",
  "Candela",
  "Catalina",
  "Soledad",
  "Milagros",
  "Laly",
  "Nadia",
  "Antonella",
  "Florencia",
  "Oriana",
] as const;

export const RESPONSABLE_REEMPLAZO = "Reemplazo";

// Dado un valor guardado, indica si corresponde a un "Reemplazo" (nombre libre
// que no está en la lista fija).
export function esReemplazo(valor: string | null | undefined): boolean {
  if (!valor) return false;
  return !RESPONSABLES_PREANALITICA.includes(valor as (typeof RESPONSABLES_PREANALITICA)[number]);
}
