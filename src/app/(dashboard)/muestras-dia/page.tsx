import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { formatTime, todayISO } from "@/lib/utils/dates";
import { landingPathForRole } from "@/lib/utils/roles";

interface Retiro {
  cantidad_muestras: number | null;
  timestamp_carga: string;
  veterinaria_texto_original: string | null;
  codigo_original: string | null;
  personal: { nombre: string } | { nombre: string }[] | null;
}

const uno = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

// Reporte de "quién trajo cuántas muestras, y de qué veterinaria" en un
// día — para que Administración lo pueda ver directo en vez de tener que
// preguntarle a DiagnoLis. Con el cliente admin a propósito: el rol "chat"
// no tiene acceso operativo directo a retiros/personal (por diseño), así
// que con el cliente de sesión esto se quedaría vacío para ellos.
export default async function MuestrasDiaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (!me || me.rol === "personal_logistica") redirect(landingPathForRole(me?.rol));

  const { fecha: fechaParam } = await searchParams;
  const fecha = fechaParam || todayISO();

  const admin = createAdminClient();
  const { data: retiros } = await admin
    .from("retiros")
    .select("cantidad_muestras, timestamp_carga, veterinaria_texto_original, codigo_original, personal:personal_id(nombre)")
    .eq("fecha_operativa", fecha)
    .eq("anulado", false)
    .neq("estado", "duplicado_sospechoso")
    .order("timestamp_carga", { ascending: true });

  const porCadete = new Map<string, { muestras: number; retiros: Retiro[] }>();
  for (const r of (retiros ?? []) as unknown as Retiro[]) {
    const nombre = uno(r.personal)?.nombre ?? "Sin asignar";
    const actual = porCadete.get(nombre) ?? { muestras: 0, retiros: [] };
    actual.muestras += r.cantidad_muestras ?? 0;
    actual.retiros.push(r);
    porCadete.set(nombre, actual);
  }
  const grupos = Array.from(porCadete.entries())
    .map(([nombre, v]) => ({ nombre, ...v }))
    .sort((a, b) => b.muestras - a.muestras);

  const totalMuestras = grupos.reduce((s, g) => s + g.muestras, 0);
  const totalRetiros = grupos.reduce((s, g) => s + g.retiros.length, 0);

  return (
    <div>
      <Topbar title="Muestras por día" />
      <div className="p-6 space-y-4">
        <form className="flex gap-2.5 items-center flex-wrap">
          <input
            type="date"
            name="fecha"
            defaultValue={fecha}
            className="px-3 py-2 border-2 border-gy200 rounded-[6px] text-[13px] bg-gy50 focus:outline-none focus:border-g500 w-40"
          />
          <button type="submit" className="flex items-center gap-1.5 px-3.5 py-2 bg-g800 text-white text-[12px] font-medium rounded-[6px] hover:bg-g700">
            <i className="ti ti-filter" /> Ver
          </button>
        </form>

        <div className="grid grid-cols-2 gap-3.5 max-w-md">
          <StatCard label="Muestras del día" value={totalMuestras} />
          <StatCard label="Retiros del día" value={totalRetiros} />
        </div>

        <div className="space-y-3.5">
          {grupos.map((g) => (
            <div key={g.nombre} className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gy100 flex items-center gap-2">
                <span className="text-[13.5px] font-semibold flex-1">{g.nombre}</span>
                <span className="text-[11px] text-gy400">{g.retiros.length} retiro{g.retiros.length === 1 ? "" : "s"}</span>
                <span className="text-[12px] font-bold text-g700">{g.muestras} muestras</span>
              </div>
              <div className="table-scroll">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-gy50">
                      {["Hora", "Veterinaria", "Código", "Muestras"].map((h) => (
                        <th key={h} className="px-3.5 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.retiros.map((r, i) => (
                      <tr key={i} className="hover:bg-gy50 border-b border-gy100 last:border-0">
                        <td className="px-3.5 py-2">{formatTime(r.timestamp_carga)}</td>
                        <td className="px-3.5 py-2">{r.veterinaria_texto_original || "—"}</td>
                        <td className="px-3.5 py-2 font-mono text-[11px] text-g700">{r.codigo_original || "—"}</td>
                        <td className="px-3.5 py-2 font-semibold">{r.cantidad_muestras}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {!grupos.length && (
            <div className="bg-white rounded-[14px] border border-gy200 shadow-sm py-8 text-center text-gy400 text-[13px]">
              Sin retiros ese día
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
