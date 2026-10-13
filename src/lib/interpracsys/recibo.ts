// Integración con la API de recibos de pago del SGE (Interpracsys): al
// adjudicar una cobranza en Diagnotest, graba el mismo pago allá para que
// quede el recibo. Doc: "API de recibos de pago (SGE)".
const URL = "https://diagnotest.interpracsys.com:9443/ws/administracion/generaRecibo.php";

// 7 = Efectivo, 18 = Transferencia electrónica (incluye Mercado Pago).
// Cuentas en pesos: 3 = Caja pesos, 9 = BBVA C/C 151-9559/9, 14 = Mercado Pago.
const MEDIO_POR_METODO: Record<string, { id_tipo_medio_cobro: number; id_cuenta: number }> = {
  efectivo: { id_tipo_medio_cobro: 7, id_cuenta: 3 },
  transferencia: { id_tipo_medio_cobro: 18, id_cuenta: 9 },
  mercado_pago: { id_tipo_medio_cobro: 18, id_cuenta: 14 },
};

export type ReciboSGEResult =
  | { ok: true; idRecibo: number; info: string }
  | { ok: false; error: string };

function fechaDDMMAAAA(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export async function generarReciboSGE(params: {
  codigoCliente: string | null | undefined;
  fechaOperativa: string;
  importe: number;
  metodoPago: string | null | undefined;
  numero: string;
  notas?: string;
}): Promise<ReciboSGEResult> {
  if (!params.codigoCliente) {
    return { ok: false, error: "La veterinaria no tiene un código del SGE vinculado" };
  }
  const medio = params.metodoPago ? MEDIO_POR_METODO[params.metodoPago] : undefined;
  if (!medio) {
    return { ok: false, error: `Medio de pago "${params.metodoPago ?? "desconocido"}" sin mapeo al SGE` };
  }
  const apiKey = process.env.INTERPRACSYS_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Falta INTERPRACSYS_API_KEY en el entorno" };
  }

  const body = {
    codigo: params.codigoCliente,
    fecha: fechaDDMMAAAA(params.fechaOperativa),
    importe: params.importe.toFixed(2),
    id_tipo_medio_cobro: medio.id_tipo_medio_cobro,
    id_cuenta: medio.id_cuenta,
    numero: params.numero,
    ...(params.notas ? { notas: params.notas } : {}),
  };

  let json: { codigo?: number; info?: string; id_recibo_pago?: number };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    json = await res.json();
  } catch (e) {
    return { ok: false, error: `No se pudo conectar con Interpracsys: ${e instanceof Error ? e.message : "error desconocido"}` };
  }

  if (json.codigo === 0) {
    return { ok: true, idRecibo: json.id_recibo_pago ?? 0, info: json.info ?? "Recibo generado" };
  }
  return { ok: false, error: `[${json.codigo}] ${json.info ?? "Error desconocido del SGE"}` };
}
