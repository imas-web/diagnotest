import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Topbar } from "@/components/layout/Topbar";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { ResumenPendientesEtapa } from "@/components/preanalitica/ResumenPendientesEtapa";
import { TableroDireccion, type DashData } from "@/components/dashboard/TableroDireccion";
import { Scorecard } from "@/components/dashboard/Scorecard";
import { esDireccion, landingPathForRole } from "@/lib/utils/roles";
import { todayISO } from "@/lib/utils/dates";

// Se recalcula cada 5 minutos: trae ~46k retiros paginados (PostgREST limita a
// 1000 filas por request), así que no conviene recalcular en cada request.
export const revalidate = 300;

type RetiroRow = { fecha_operativa: string; personal_id: string; veterinaria_id: string | null; veterinaria_texto_original: string | null; cantidad_muestras: number | null };
type VetRow = { id: string; nombre: string; zona_id: string | null };
type PersonalRow = { id: string; nombre: string };
type ZonaRow = { id: string; nombre: string };
type ControlMesRow = { estado: string; responsable_2: string | null; updated_at: string; retiro: { timestamp_carga: string } | { timestamp_carga: string }[] | null };
type CobranzaMesRow = { estado: string; importe_declarado: number | null; importe_validado: number | null };

// Pagina un select simple (sin joins) trayendo TODAS las filas: PostgREST
// limita cada request a 1000 filas, así que se piden todas las páginas en
// paralelo una vez que sabemos el total (más rápido que ir de a una).
async function fetchAllSimple<T>(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  cols: string,
  filter: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
  pageSize = 1000
): Promise<T[]> {
  const { count } = await filter(admin.from(table).select("id", { count: "exact", head: true }));
  const total = count ?? 0;
  if (!total) return [];
  const pages = Math.ceil(total / pageSize);
  const chunks = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      filter(admin.from(table).select(cols).order("id", { ascending: true })).range(i * pageSize, i * pageSize + pageSize - 1)
    )
  );
  return chunks.flatMap((c) => (c.data as T[]) ?? []);
}

// Día calendario (UTC, sin depender de la zona del visitante) como entero de
// días desde el epoch — evita off-by-one entre el server y el navegador.
function dayIndexUTC(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
function isoOfDayIndex(dayIdx: number): string {
  return new Date(dayIdx * 86400000).toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const supabase = await createClient();

  // El Dashboard Operativo es exclusivo de dirección; otros roles van a su landing.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: rolRow } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!esDireccion(rolRow?.rol)) redirect(landingPathForRole(rolRow?.rol));

  // Lecturas pesadas con service role (mismo patrón que preanalítica/cobranzas
  // para evitar el bug de "0 filas" por un blip de sesión RLS).
  const admin = createAdminClient();
  const today = todayISO();
  const firstDayMonth = today.slice(0, 7) + "-01";
  const [fy, fm] = firstDayMonth.split("-").map(Number);
  const firstDayPrevMonth = new Date(Date.UTC(fy, fm - 2, 1)).toISOString().slice(0, 10);

  const [
    retirosRows, vetsRows, personalRows, zonasRows, controlesMes, cobranzasMes,
    okCount, obsCount, rechCount, pendCount,
    okCountPrev, obsCountPrev, rechCountPrev, tiempoControlHsPrev, cobranzasPrevMes,
  ] = await Promise.all([
    fetchAllSimple<RetiroRow>(admin, "retiros", "fecha_operativa,personal_id,veterinaria_id,veterinaria_texto_original,cantidad_muestras",
      (q) => q.eq("anulado", false).neq("estado", "duplicado_sospechoso")),
    fetchAllSimple<VetRow>(admin, "veterinarias", "id,nombre,zona_id", (q) => q),
    admin.from("personal").select("id,nombre").order("nombre").then((r) => (r.data as PersonalRow[]) ?? []),
    admin.from("zonas").select("id,nombre").order("nombre").then((r) => (r.data as ZonaRow[]) ?? []),
    // Productividad de preanalítica + tiempo de control: controles del mes en curso.
    (async () => {
      const countQ = admin.from("control_preanalitica")
        .select("id, retiro:retiro_id!inner(fecha_operativa)", { count: "exact", head: true })
        .neq("estado", "pendiente").gte("retiro.fecha_operativa", firstDayMonth);
      const { count } = await countQ;
      const total = count ?? 0;
      if (!total) return [] as ControlMesRow[];
      const pages = Math.ceil(total / 1000);
      const chunks = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          admin.from("control_preanalitica")
            .select("estado,responsable_2,updated_at,retiro:retiro_id!inner(timestamp_carga,fecha_operativa)")
            .neq("estado", "pendiente").gte("retiro.fecha_operativa", firstDayMonth)
            .range(i * 1000, i * 1000 + 999)
        )
      );
      return chunks.flatMap((c) => (c.data as unknown as ControlMesRow[]) ?? []);
    })(),
    // Cobranzas en efectivo del mes en curso.
    (async () => {
      const countQ = admin.from("control_cobranzas")
        .select("id, retiro:retiro_id!inner(fecha_operativa)", { count: "exact", head: true })
        .gte("retiro.fecha_operativa", firstDayMonth);
      const { count } = await countQ;
      const total = count ?? 0;
      if (!total) return [] as CobranzaMesRow[];
      const pages = Math.ceil(total / 1000);
      const chunks = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          admin.from("control_cobranzas")
            .select("estado,importe_declarado,importe_validado,retiro:retiro_id!inner(fecha_operativa)")
            .gte("retiro.fecha_operativa", firstDayMonth)
            .range(i * 1000, i * 1000 + 999)
        )
      );
      return chunks.flatMap((c) => (c.data as unknown as CobranzaMesRow[]) ?? []);
    })(),
    admin.from("control_preanalitica").select("id", { count: "exact", head: true }).eq("estado", "ok").gte("updated_at", firstDayMonth).then((r) => r.count ?? 0),
    admin.from("control_preanalitica").select("id", { count: "exact", head: true }).eq("estado", "observado").gte("updated_at", firstDayMonth).then((r) => r.count ?? 0),
    admin.from("control_preanalitica").select("id", { count: "exact", head: true }).eq("estado", "rechazado").gte("updated_at", firstDayMonth).then((r) => r.count ?? 0),
    admin.from("control_preanalitica").select("id", { count: "exact", head: true }).eq("estado", "pendiente").eq("cancelado", false).then((r) => r.count ?? 0),
    // ---- Mes anterior (para el Scorecard: compara mes en curso vs mes cerrado) ----
    admin.from("control_preanalitica").select("id", { count: "exact", head: true }).eq("estado", "ok").gte("updated_at", firstDayPrevMonth).lt("updated_at", firstDayMonth).then((r) => r.count ?? 0),
    admin.from("control_preanalitica").select("id", { count: "exact", head: true }).eq("estado", "observado").gte("updated_at", firstDayPrevMonth).lt("updated_at", firstDayMonth).then((r) => r.count ?? 0),
    admin.from("control_preanalitica").select("id", { count: "exact", head: true }).eq("estado", "rechazado").gte("updated_at", firstDayPrevMonth).lt("updated_at", firstDayMonth).then((r) => r.count ?? 0),
    (async () => {
      const countQ = admin.from("control_preanalitica")
        .select("id, retiro:retiro_id!inner(fecha_operativa)", { count: "exact", head: true })
        .neq("estado", "pendiente").gte("retiro.fecha_operativa", firstDayPrevMonth).lt("retiro.fecha_operativa", firstDayMonth);
      const { count } = await countQ;
      const total = count ?? 0;
      if (!total) return 0;
      const pages = Math.ceil(total / 1000);
      const chunks = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          admin.from("control_preanalitica")
            .select("updated_at,retiro:retiro_id!inner(timestamp_carga,fecha_operativa)")
            .neq("estado", "pendiente").gte("retiro.fecha_operativa", firstDayPrevMonth).lt("retiro.fecha_operativa", firstDayMonth)
            .range(i * 1000, i * 1000 + 999)
        )
      );
      const filas = chunks.flatMap((c) => (c.data as unknown as ControlMesRow[]) ?? []);
      const tiempos = filas.map((c) => {
        const retiro = Array.isArray(c.retiro) ? c.retiro[0] : c.retiro;
        if (!retiro) return null;
        const ms = new Date(c.updated_at).getTime() - new Date(retiro.timestamp_carga).getTime();
        return ms > 0 ? ms / 3600000 : null;
      }).filter((v): v is number => v !== null);
      return tiempos.length ? tiempos.reduce((s, v) => s + v, 0) / tiempos.length : 0;
    })(),
    (async () => {
      const countQ = admin.from("control_cobranzas")
        .select("id, retiro:retiro_id!inner(fecha_operativa)", { count: "exact", head: true })
        .gte("retiro.fecha_operativa", firstDayPrevMonth).lt("retiro.fecha_operativa", firstDayMonth);
      const { count } = await countQ;
      const total = count ?? 0;
      if (!total) return [] as CobranzaMesRow[];
      const pages = Math.ceil(total / 1000);
      const chunks = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          admin.from("control_cobranzas")
            .select("estado,importe_declarado,importe_validado,retiro:retiro_id!inner(fecha_operativa)")
            .gte("retiro.fecha_operativa", firstDayPrevMonth).lt("retiro.fecha_operativa", firstDayMonth)
            .range(i * 1000, i * 1000 + 999)
        )
      );
      return chunks.flatMap((c) => (c.data as unknown as CobranzaMesRow[]) ?? []);
    })(),
  ]);

  // ---- Índices compactos (nombre → número) para mandar un payload chico al cliente ----
  const cadIndexById = new Map<string, number>();
  personalRows.forEach((c, i) => cadIndexById.set(c.id, i));
  const cadetes = personalRows.map((c) => c.nombre);

  const vetMaster = new Map<string, VetRow>();
  vetsRows.forEach((v) => vetMaster.set(v.id, v));
  const zonaIndexById = new Map<string, number>(); // 0 reservado para "Sin zona"
  zonasRows.forEach((z, i) => zonaIndexById.set(z.id, i + 1));
  const zonas = ["Sin zona", ...zonasRows.map((z) => z.nombre)];

  const vetIndexByKey = new Map<string, number>();
  const vetsOut: [string, number][] = [];
  function vetIndexFor(veterinariaId: string | null, texto: string): number {
    const key = veterinariaId ?? "txt:" + texto.trim().toLowerCase();
    const existing = vetIndexByKey.get(key);
    if (existing !== undefined) return existing;
    let nombre = texto || "?", zonaIdx = 0;
    if (veterinariaId) {
      const m = vetMaster.get(veterinariaId);
      // La zona SIEMPRE sale del vínculo veterinaria→zona (nunca del cadete, que puede rotar).
      if (m) { nombre = m.nombre; zonaIdx = m.zona_id ? (zonaIndexById.get(m.zona_id) ?? 0) : 0; }
    }
    const idx = vetsOut.length;
    vetsOut.push([nombre, zonaIdx]);
    vetIndexByKey.set(key, idx);
    return idx;
  }

  let minDay = Infinity;
  for (const r of retirosRows) { const d = dayIndexUTC(r.fecha_operativa); if (d < minDay) minDay = d; }
  if (!isFinite(minDay)) minDay = dayIndexUTC(today);

  const bucket = new Map<string, [number, number, number, number, number]>();
  for (const r of retirosRows) {
    const cad = cadIndexById.get(r.personal_id);
    if (cad === undefined) continue;
    const vet = vetIndexFor(r.veterinaria_id, r.veterinaria_texto_original ?? "?");
    const day = dayIndexUTC(r.fecha_operativa) - minDay;
    const key = day + "|" + cad + "|" + vet;
    const cur = bucket.get(key);
    if (cur) { cur[3] += 1; cur[4] += r.cantidad_muestras ?? 0; }
    else bucket.set(key, [day, cad, vet, 1, r.cantidad_muestras ?? 0]);
  }
  const rows: number[] = [];
  for (const v of Array.from(bucket.values())) rows.push(...v);

  // ---- Calidad (mes en curso, salvo pendientes que es backlog global) ----
  const totalJuzgado = okCount + obsCount + rechCount;
  const tiemposHs = controlesMes
    .map((c) => {
      const retiro = Array.isArray(c.retiro) ? c.retiro[0] : c.retiro;
      if (!retiro) return null;
      const ms = new Date(c.updated_at).getTime() - new Date(retiro.timestamp_carga).getTime();
      return ms > 0 ? ms / 3600000 : null;
    })
    .filter((v): v is number => v !== null);
  const tiempoControlHs = tiemposHs.length ? tiemposHs.reduce((s, v) => s + v, 0) / tiemposHs.length : 0;

  // ---- Productividad por persona + carga por hora (mes en curso) ----
  const porPersona = new Map<string, number>();
  const porHora = new Map<number, number>();
  for (const c of controlesMes) {
    const nombre = c.responsable_2?.trim();
    if (nombre) porPersona.set(nombre, (porPersona.get(nombre) ?? 0) + 1);
    const hora = new Date(c.updated_at).getUTCHours(); // BA = UTC-3 fijo
    const horaBA = (hora + 21) % 24; // UTC-3
    porHora.set(horaBA, (porHora.get(horaBA) ?? 0) + 1);
  }
  const productividad = Array.from(porPersona.entries()).map(([persona, count]) => ({ persona, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  const cargaPorHora = Array.from(porHora.entries()).map(([hora, count]) => ({ hora, count })).sort((a, b) => a.hora - b.hora);

  // ---- Cobranzas · solo efectivo (mes en curso) ----
  const efectivoDeclarado = cobranzasMes.reduce((s, c) => s + (c.importe_declarado ?? 0), 0);
  const efectivoValidado = cobranzasMes.filter((c) => c.estado !== "pendiente").reduce((s, c) => s + (c.importe_validado ?? c.importe_declarado ?? 0), 0);
  const cobranzasPendientes = cobranzasMes.filter((c) => c.estado === "pendiente").length;

  // ---- Mes anterior (referencia del Scorecard) ----
  const totalJuzgadoPrev = okCountPrev + obsCountPrev + rechCountPrev;
  const efectivoDeclaradoPrev = cobranzasPrevMes.reduce((s, c) => s + (c.importe_declarado ?? 0), 0);
  const efectivoValidadoPrev = cobranzasPrevMes.filter((c) => c.estado !== "pendiente").reduce((s, c) => s + (c.importe_validado ?? c.importe_declarado ?? 0), 0);

  const data: DashData = {
    baseISO: isoOfDayIndex(minDay),
    cadetes,
    zonas,
    vets: vetsOut,
    rows,
    calidad: {
      okPct: totalJuzgado ? (okCount / totalJuzgado) * 100 : 100,
      observadoPct: totalJuzgado ? (obsCount / totalJuzgado) * 100 : 0,
      observadoCount: obsCount,
      pendientes: pendCount,
      tiempoControlHs,
    },
    cobranzas: {
      efectivoDeclarado,
      efectivoValidado,
      pendientes: cobranzasPendientes,
    },
    productividad,
    cargaPorHora,
    calidadPrev: {
      okPct: totalJuzgadoPrev ? (okCountPrev / totalJuzgadoPrev) * 100 : 100,
      tiempoControlHs: tiempoControlHsPrev,
    },
    cobranzasPrev: {
      efectivoDeclarado: efectivoDeclaradoPrev,
      efectivoValidado: efectivoValidadoPrev,
    },
  };

  return (
    <div>
      <Topbar title="Dashboard Operativo" />
      <div className="p-6">
        <DashboardTabs
          operativo={<ResumenPendientesEtapa />}
          general={<TableroDireccion data={data} />}
          scorecard={<Scorecard data={data} />}
        />
      </div>
    </div>
  );
}
