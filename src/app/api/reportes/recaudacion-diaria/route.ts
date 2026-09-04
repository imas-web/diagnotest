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

  const cadetes = Array.from(new Set(filas.map((f) => f.cadete))).sort((a, b) => a.localeCompare(b, "es"));
  const fechas = Array.from(new Set(filas.map((f) => f.fecha_operativa))).sort((a, b) => b.localeCompare(a));

  const porFechaCadete = new Map<string, number>();
  for (const f of filas) porFechaCadete.set(`${f.fecha_operativa}|${f.cadete}`, Number(f.recaudado));

  const csvEscape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

  const header = ["Fecha", ...cadetes, "Total"].map(csvEscape).join(",");
  const lineas = fechas.map((fecha) => {
    let total = 0;
    const valores = cadetes.map((c) => {
      const monto = porFechaCadete.get(`${fecha}|${c}`) ?? 0;
      total += monto;
      return monto ? String(Math.round(monto)) : "";
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
