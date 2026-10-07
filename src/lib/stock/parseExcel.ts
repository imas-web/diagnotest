import * as XLSX from "xlsx";

// El excel que Noelia/Natalia bajan de Interpracsys (uno por sector, o el
// listado completo) no siempre trae las mismas columnas ni en el mismo
// orden — a veces falta "Categoria" o "Almacen" si el export es de un solo
// sector. Por eso se mapea por NOMBRE de columna (normalizado, sin tildes
// ni mayúsculas), no por posición, y solo Código/Nombre/Stock/Stock Mínimo
// son obligatorios.
export type FilaStock = {
  codigo: string;
  nombre: string;
  categoria: string | null;
  almacen: string | null;
  stock: number;
  stockMinimo: number;
};

export type ResultadoParseo = {
  filas: FilaStock[];
  errores: string[];
  // Si el archivo no trae Categoria/Almacen (export de un solo sector), el
  // caller no debe pisar lo que ya había guardado para esos campos.
  tieneCategoria: boolean;
  tieneAlmacen: boolean;
};

function normalizarHeader(h: unknown): string {
  return String(h ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // sin tildes
    .trim().toLowerCase().replace(/\s+/g, " ");
}

const ALIAS: Record<string, string[]> = {
  codigo: ["codigo", "cod"],
  nombre: ["nombre"],
  categoria: ["categoria"],
  almacen: ["almacen"],
  stock: ["stock", "stk"],
  stockMinimo: ["stock min", "stock minimo", "stockmin", "stockminimo"],
};

function numero(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "0").replace(",", "."));
  return isFinite(n) ? n : 0;
}

export function parsearExcelStock(buffer: Buffer): ResultadoParseo {
  const errores: string[] = [];
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { filas: [], errores: ["No se pudo leer el archivo — ¿es un .xlsx válido?"], tieneCategoria: false, tieneAlmacen: false };
  }
  const hoja = wb.Sheets[wb.SheetNames[0]];
  if (!hoja) return { filas: [], errores: ["El archivo no tiene hojas."], tieneCategoria: false, tieneAlmacen: false };

  const filasCrudas: unknown[][] = XLSX.utils.sheet_to_json(hoja, { header: 1, blankrows: false });
  if (filasCrudas.length < 2) return { filas: [], errores: ["El archivo no tiene filas de datos."], tieneCategoria: false, tieneAlmacen: false };

  const headers = filasCrudas[0].map(normalizarHeader);
  const indicePor: Record<string, number> = {};
  for (const [campo, alias] of Object.entries(ALIAS)) {
    const idx = headers.findIndex((h) => alias.includes(h));
    if (idx !== -1) indicePor[campo] = idx;
  }

  const faltantes = ["codigo", "nombre", "stock", "stockMinimo"].filter((c) => indicePor[c] === undefined);
  if (faltantes.length) {
    return {
      filas: [],
      errores: [
        `Faltan columnas obligatorias: ${faltantes.join(", ")}. Columnas encontradas: ${filasCrudas[0].join(", ")}`,
      ],
      tieneCategoria: false,
      tieneAlmacen: false,
    };
  }
  const tieneCategoria = indicePor.categoria !== undefined;
  const tieneAlmacen = indicePor.almacen !== undefined;

  const filas: FilaStock[] = [];
  for (let i = 1; i < filasCrudas.length; i++) {
    const fila = filasCrudas[i];
    const codigo = String(fila[indicePor.codigo] ?? "").trim();
    const nombre = String(fila[indicePor.nombre] ?? "").trim();
    if (!codigo || !nombre) continue; // fila vacía o de relleno
    filas.push({
      codigo,
      nombre,
      categoria: indicePor.categoria !== undefined ? (String(fila[indicePor.categoria] ?? "").trim() || null) : null,
      almacen: indicePor.almacen !== undefined ? (String(fila[indicePor.almacen] ?? "").trim() || null) : null,
      stock: numero(fila[indicePor.stock]),
      stockMinimo: numero(fila[indicePor.stockMinimo]),
    });
  }

  if (!filas.length) errores.push("No se encontró ninguna fila válida (con código y nombre).");
  return { filas, errores, tieneCategoria, tieneAlmacen };
}
