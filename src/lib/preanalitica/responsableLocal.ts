// "¿Quién controla?" en Control 1 se recuerda por CUENTA: ahí son 2 personas
// fijas que controlan todo el día, así que tiene sentido atarlo al login.
// Control 2 en cambio se recuerda por DISPOSITIVO/navegador (ignora
// usuarioId): ahí rota cualquiera de varias personas y no coincide 1:1 con la
// cuenta logueada (a veces la misma cuenta la usan personas distintas a lo
// largo del día) — atarlo a la cuenta hacía que el "último que elegí" se
// perdiera o quedara desactualizado apenas cambiaba quién estaba controlando,
// obligando a re-elegir en cada ficha.
export type EtapaResponsable = "c1" | "c2";

function lsKey(etapa: EtapaResponsable, usuarioId: string): string {
  if (etapa === "c2") return "diagnotest_preanalitica_resp_c2";
  return `diagnotest_preanalitica_resp_${etapa}_${usuarioId}`;
}

export function leerRespGuardado(etapa: EtapaResponsable, usuarioId: string): string | null {
  try {
    return localStorage.getItem(lsKey(etapa, usuarioId)) || null;
  } catch {
    return null;
  }
}

export function guardarResp(etapa: EtapaResponsable, usuarioId: string, valor: string | null) {
  try {
    if (valor) localStorage.setItem(lsKey(etapa, usuarioId), valor);
    else localStorage.removeItem(lsKey(etapa, usuarioId));
  } catch {
    /* localStorage no disponible (ej. navegación privada) */
  }
}
