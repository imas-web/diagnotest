// "¿Quién controla?" se recuerda por CUENTA (no por bandeja compartida ni por
// un "activo" global): cada preanalítica que abre su sesión ve precargado lo
// último que ELLA eligió, nunca lo que marcó otra persona. Se usa tanto en la
// barra superior de la bandeja (aplicar en lote) como en el selector de cada
// ficha individual (ver ControlCard). La clave incluye el usuarioId (no solo
// la etapa) porque varias cuentas pueden compartir la misma compu/navegador
// a lo largo del día.
export type EtapaResponsable = "c1" | "c2";

function lsKey(etapa: EtapaResponsable, usuarioId: string): string {
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
