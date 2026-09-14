import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { todayISO } from "@/lib/utils/dates";
import { landingPathForRole } from "@/lib/utils/roles";

// Reporte simple de "quién trajo cuántas muestras" en un día — para que
// Administración lo pueda ver directo en vez de tener que preguntarle a
// DiagnoLis. Con el cliente admin a propósito: el rol "chat" no tiene
// acceso operativo directo a retiros/personal (por diseño), así que con
// el cliente de sesión esto se quedaría vacío para ellos.
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
    .select("cantidad_muestras, personal:personal_id(nombre)")
    .eq("fecha_operativa", fecha)
    .eq("anulado", false)
    .neq("estado", "duplicado_sospechoso");

  const porCadete = new Map<string, { muestras: number; retiros: number }>();
  for (const r of retiros ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nombre = (r.personal as any)?.nombre ?? "Sin asignar";
    const actual = porCadete.get(nombre) ?? { muestras: 0, retiros: 0 };
    actual.muestras += r.cantidad_muestras ?? 0;
    actual.retiros += 1;
    porCadete.set(nombre, actual);
  }
  const filas = Array.from(porCadete.entries())
    .map(([nombre, v]) => ({ nombre, ...v }))
    .sort((a, b) => b.muestras - a.muestras);

  const totalMuestras = filas.reduce((s, f) => s + f.muestras, 0);
  const totalRetiros = filas.reduce((s, f) => s + f.retiros, 0);

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

        <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
          <div className="px-4 py-3.5 border-b border-gy100">
            <span className="text-[14px] font-semibold">{fecha}</span>
          </div>
          <div className="table-scroll">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-gy50">
                  {["Cadete", "Muestras", "Retiros"].map((h) => (
                    <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.nombre} className="hover:bg-gy50 border-b border-gy100 last:border-0">
                    <td className="px-3.5 py-2.5 font-medium text-gy900">{f.nombre}</td>
                    <td className="px-3.5 py-2.5 font-semibold text-g700">{f.muestras}</td>
                    <td className="px-3.5 py-2.5">{f.retiros}</td>
                  </tr>
                ))}
                {!filas.length && (
                  <tr><td colSpan={3} className="py-8 text-center text-gy400">Sin retiros ese día</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
