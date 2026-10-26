import { redirect } from "next/navigation";
import { getMyProfile } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withTimeout } from "@/lib/supabase/withTimeout";
import { Topbar } from "@/components/layout/Topbar";
import { puedeVerReportesAvanzados, landingPathForRole } from "@/lib/utils/roles";
import { todayISO } from "@/lib/utils/dates";
import { normVet } from "@/lib/pedidos/match";
import { VeterinariasMovimiento, type FilaMovimiento } from "@/components/reportes/VeterinariasMovimiento";

// Reporte puntual (no por rol, ver puedeVerReportesAvanzados) con las
// veterinarias que más aumentaron y más disminuyeron las muestras que
// mandan. Se compara contra el MISMO rango de días del mes anterior (ej. 1
// al 26 de octubre vs. 1 al 26 de septiembre) — nunca contra el mes anterior
// completo, porque mientras el mes en curso no terminó eso haría ver "en
// baja" a cualquiera solo por tener menos días todavía.
export const dynamic = "force-dynamic";

const DB_TIMEOUT = 20000;
async function qTimeout<T>(p: PromiseLike<T>, fallback: T, ms = DB_TIMEOUT): Promise<T> {
  try {
    return await withTimeout(p, ms);
  } catch {
    return fallback;
  }
}

type RetiroRow = { veterinaria_id: string | null; veterinaria_texto_original: string | null; cantidad_muestras: number | null };
type VetRow = { id: string; nombre: string };

export default async function VeterinariasMovimientoPage() {
  const { user, profile } = await getMyProfile();
  if (!user) redirect("/login");
  if (!puedeVerReportesAvanzados(user.email)) redirect(landingPathForRole(profile?.rol));

  const admin = createAdminClient();
  const today = todayISO();
  const [y, m, d] = today.split("-").map(Number);
  const diasTranscurridos = d;

  const inicioActual = `${y}-${String(m).padStart(2, "0")}-01`;
  const finActual = today;

  const prevYM = new Date(Date.UTC(y, m - 2, 1));
  const yP = prevYM.getUTCFullYear(), mP = prevYM.getUTCMonth() + 1;
  const diasEnMesAnterior = new Date(Date.UTC(yP, mP, 0)).getUTCDate();
  const diaFinAnterior = Math.min(diasTranscurridos, diasEnMesAnterior);
  const inicioAnterior = `${yP}-${String(mP).padStart(2, "0")}-01`;
  const finAnterior = `${yP}-${String(mP).padStart(2, "0")}-${String(diaFinAnterior).padStart(2, "0")}`;

  async function fetchAllRows<T>(
    build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
  ): Promise<T[]> {
    const rows: T[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(from, from + PAGE - 1);
      if (error || !data?.length) break;
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    return rows;
  }

  const [retirosActual, retirosAnterior, vetsRows] = await Promise.all([
    qTimeout(fetchAllRows<RetiroRow>((from, to) =>
      admin.from("retiros")
        .select("veterinaria_id, veterinaria_texto_original, cantidad_muestras")
        .eq("anulado", false).neq("estado", "duplicado_sospechoso" as never)
        .gte("fecha_operativa", inicioActual).lte("fecha_operativa", finActual)
        .order("id", { ascending: true })
        .range(from, to)
    ), [] as RetiroRow[]),
    qTimeout(fetchAllRows<RetiroRow>((from, to) =>
      admin.from("retiros")
        .select("veterinaria_id, veterinaria_texto_original, cantidad_muestras")
        .eq("anulado", false).neq("estado", "duplicado_sospechoso" as never)
        .gte("fecha_operativa", inicioAnterior).lte("fecha_operativa", finAnterior)
        .order("id", { ascending: true })
        .range(from, to)
    ), [] as RetiroRow[]),
    qTimeout(admin.from("veterinarias").select("id, nombre").then((r) => (r.data as VetRow[]) ?? []), [] as VetRow[]),
  ]);

  const vetMaster = new Map<string, string>();
  vetsRows.forEach((v) => vetMaster.set(v.id, v.nombre));

  function keyNombreDe(r: RetiroRow): [string, string] {
    if (r.veterinaria_id) return [r.veterinaria_id, vetMaster.get(r.veterinaria_id) ?? r.veterinaria_texto_original ?? "?"];
    const norm = normVet(r.veterinaria_texto_original);
    return ["txt:" + norm, r.veterinaria_texto_original || "?"];
  }

  function agregar(rows: RetiroRow[]): Map<string, { nombre: string; muestras: number }> {
    const m = new Map<string, { nombre: string; muestras: number }>();
    for (const r of rows) {
      const [key, nombre] = keyNombreDe(r);
      const prev = m.get(key) ?? { nombre, muestras: 0 };
      prev.muestras += Number(r.cantidad_muestras ?? 0);
      m.set(key, prev);
    }
    return m;
  }

  const mapActual = agregar(retirosActual);
  const mapAnterior = agregar(retirosAnterior);

  const keys = new Set([...Array.from(mapActual.keys()), ...Array.from(mapAnterior.keys())]);
  const filas: FilaMovimiento[] = Array.from(keys).map((key) => {
    const a = mapActual.get(key);
    const p = mapAnterior.get(key);
    const muestrasActual = a?.muestras ?? 0;
    const muestrasAnterior = p?.muestras ?? 0;
    return {
      veterinaria: (a ?? p)!.nombre,
      muestrasActual,
      muestrasAnterior,
      delta: muestrasActual - muestrasAnterior,
      pct: muestrasAnterior > 0 ? Math.round(((muestrasActual - muestrasAnterior) / muestrasAnterior) * 1000) / 10 : null,
      nuevo: muestrasAnterior === 0 && muestrasActual > 0,
    };
  });

  const aumentaron = filas.filter((f) => f.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 100);
  const disminuyeron = filas.filter((f) => f.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 100);

  const fmtRango = (ini: string, fin: string) => {
    const [, mm, dd] = fin.split("-");
    const [, mi] = ini.split("-");
    return mi === mm ? `1 al ${Number(dd)} de ${mesNombre(Number(mm))}` : `${ini} a ${fin}`;
  };
  function mesNombre(n: number) {
    return ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][n - 1];
  }

  return (
    <div>
      <Topbar title="Veterinarias · Movimiento de muestras" subtitle="Quién aumentó y quién bajó, mismo rango de días que el mes anterior" />
      <div className="p-6">
        <VeterinariasMovimiento
          aumentaron={aumentaron}
          disminuyeron={disminuyeron}
          rangoActualTxt={fmtRango(inicioActual, finActual)}
          rangoAnteriorTxt={fmtRango(inicioAnterior, finAnterior)}
        />
      </div>
    </div>
  );
}
