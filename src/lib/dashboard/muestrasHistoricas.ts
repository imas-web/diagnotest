// Histórico mensual de "muestras totales" (2011–ago/2026), reconstruido desde la
// planilla de estadísticas que se cargaba a mano (hoja "Indicadores"/"Inicio" de
// Estadisticas.xlsx, compartida por Marina el 2026-09-21). Antes de que existiera
// la plataforma de logística este era el único registro del volumen del laboratorio;
// se usa para poner metas mensuales de "Muestras" con contexto de varios años
// (estacionalidad, crecimiento interanual) en vez de solo el poco historial que
// tiene la plataforma (arrancó en junio/2026).
//
// A partir de junio/2026 los números reales vienen de la plataforma — esta tabla
// no se vuelve a actualizar a mano; es un snapshot congelado al momento de la carga.
export const MUESTRAS_HISTORICAS: Record<number, (number | null)[]> = {
  2011: [7667, 7536, 8642, 8188, 8447, 8399, 8715, 8947, 9029, 8972, 9561, 8654],
  2012: [8949, 8251, 10016, 7911, 9443, 8315, 9741, 9797, 9075, 9997, 9926, 9105],
  2013: [10220, 8726, 9741, 9876, 9597, 8814, 9798, 10212, 9253, 10641, 10260, 9169],
  2014: [10096, 9490, 10297, 9544, 10144, 9419, 10093, 10414, 10483, 10822, 10272, 9969],
  2015: [10594, 9967, 10698, 10418, 10059, 10461, 11213, 10727, 11412, 11792, 10965, 10963],
  2016: [11600, 11142, 12198, 11291, 11648, 11037, 11621, 12567, 11831, 12713, 14122, 13208],
  2017: [13324, 11654, 14030, 12297, 12468, 11996, 13336, 14186, 13739, 14502, 15768, 15721],
  2018: [15668, 13392, 15010, 13543, 14142, 13587, 14247, 14770, 14202, 17005, 18322, 17113],
  2019: [18551, 16822, 16909, 16073, 16580, 15684, 18065, 17512, 17448, 18387, 20089, 19236],
  2020: [21792, 18507, 13967, 12606, 20149, 22382, 24176, 26787, 27088, 28989, 29089, 27895],
  2021: [27469, 24794, 28561, 26522, 26479, 26996, 29176, 28809, 28046, 28682, 30294, 30072],
  2022: [27639, 27721, 30353, 28449, 28551, 27187, 29648, 30673, 29802, 29748, 32550, 30279],
  2023: [33062, 28777, 34186, 31833, 31532, 31224, 34211, 33936, 32161, 31662, 34190, 31445],
  2024: [32940, 27804, 29613, 29468, 30068, 29459, 33769, 32054, 31385, 34255, 35232, 33615],
  2025: [36271, 30780, 32982, 34463, 34468, 31501, 36635, 35421, 35106, 37820, 35850, 36758],
  // may–dic 2026: null hasta que se completen (la plataforma toma la posta desde junio).
  2026: [39151, 32895, 36970, 36309, 35646, 36298, 38709, 40104, null, null, null, null],
};

// Promedio del mismo mes calendario (1-12) en los N años anteriores con dato —
// meta "estacional" para comparar el mes en curso contra su propia historia.
export function promedioHistoricoMes(mesIdx0: number, anioActual: number, nAnios = 5): number | null {
  const vals: number[] = [];
  for (let y = anioActual - 1; y >= anioActual - nAnios - 3 && vals.length < nAnios; y--) {
    const v = MUESTRAS_HISTORICAS[y]?.[mesIdx0];
    if (v != null) vals.push(v);
  }
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

// Valor del mismo mes calendario un año atrás (para variación interanual).
export function mesAnioAnterior(mesIdx0: number, anioActual: number): number | null {
  return MUESTRAS_HISTORICAS[anioActual - 1]?.[mesIdx0] ?? null;
}
