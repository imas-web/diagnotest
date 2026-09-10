import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Reporte CSV de recaudación diaria por cadete, pensado para que Google
// Sheets lo levante solo con =IMPORTDATA(...) y se mantenga actualizado
// (Sheets refresca el import periódicamente sin que nadie tenga que hacer
// nada). No usa la sesión del usuario: lo protege un token fijo por query
// param, ya que quien lo pide es el servidor de Google, no el navegador.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token || token !== process.env.REPORTES_TOKEN) {
    return new NextResponse("No autorizado", { status: 401 });
  }

  // ?agrupar=semana agrega por semana (lunes a domingo) en vez de por día —
  // misma forma de CSV, para pegar en otra pestaña con otro IMPORTDATA.
  const agrupar = request.nextUrl.searchParams.get("agrupar") === "semana" ? "semana" : "dia";

  function inicioDeSemanaISO(fechaISO: string): string {
    const d = new Date(`${fechaISO}T12:00:00Z`);
    const dow = d.getUTCDay(); // 0=domingo..6=sábado
    const diffALunes = dow === 0 ? 6 : dow - 1;
    d.setUTCDate(d.getUTCDate() - diffALunes);
    return d.toISOString().slice(0, 10);
  }

  const admin = createAdminClient();

  type Fila = { fecha_operativa: string; cadete: string; recaudado: number };
  const filas: Fila[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("vista_recaudacion_diaria")
      .select("fecha_operativa, cadete, recaudado")
      .range(from, from + PAGE - 1);
    if (error) return new NextResponse(`Error: ${error.message}`, { status: 500 });
    if (!data?.length) break;
    filas.push(...(data as Fila[]));
    if (data.length < PAGE) break;
  }

  const clave = (f: Fila) => (agrupar === "semana" ? inicioDeSemanaISO(f.fecha_operativa) : f.fecha_operativa);

  const cadetes = Array.from(new Set(filas.map((f) => f.cadete))).sort((a, b) => a.localeCompare(b, "es"));
  const fechas = Array.from(new Set(filas.map(clave))).sort((a, b) => b.localeCompare(a));

  const porFechaCadete = new Map<string, number>();
  for (const f of filas) {
    const k = `${clave(f)}|${f.cadete}`;
    porFechaCadete.set(k, (porFechaCadete.get(k) ?? 0) + Number(f.recaudado));
  }

  const csvEscape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

  const header = [agrupar === "semana" ? "Semana (lunes)" : "Fecha", ...cadetes, "Total"].map(csvEscape).join(",");
  const lineas = fechas.map((fecha) => {
    let total = 0;
    const valores = cadetes.map((c) => {
      const clave = `${fecha}|${c}`;
      const monto = porFechaCadete.get(clave) ?? 0;
      total += monto;
      // Distinguir "no trabajó ese día" (celda vacía) de "trabajó y cobró
      // $0" (existe la clave, pero suma 0 — caso válido en el sistema):
      // antes ambos se mostraban en blanco, indistinguibles entre sí.
      return porFechaCadete.has(clave) ? String(Math.round(monto)) : "";
    });
    return [fecha, ...valores, String(Math.round(total))].join(",");
  });

  const csv = [header, ...lineas].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
