import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Topbar } from "@/components/layout/Topbar";
import { formatDateTime } from "@/lib/utils/dates";
import { fmtMoneySign } from "@/lib/utils/format";
import { DuplicadoActions } from "@/components/forms/DuplicadoActions";
import { landingPathForRole } from "@/lib/utils/roles";

// Caché corta (10s); Confirmar/Anular revalidan al instante.
export const revalidate = 10;

const ROLES_PAGINA = ["jefe_logistica", "preanalitica", "dueno", "super_admin"];

export default async function DuplicadosPage() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await auth.from("profiles").select("rol").eq("id", user.id).single();
  if (!perfil || !ROLES_PAGINA.includes(perfil.rol)) redirect(landingPathForRole(perfil?.rol));

  // Lectura con admin (service role): igual que la bandeja y Observados, no
  // depende de la sesión/RLS — que bajo carga o en ciertos estados de sesión
  // podían devolver 0 filas sin error, mostrando "Sin duplicados" con datos
  // reales cargados.
  const supabase = createAdminClient();

  const { data: duplicados } = await supabase
    .from("retiros")
    .select(`
      id, fecha_operativa, timestamp_carga, cantidad_muestras, importe_declarado,
      veterinaria_texto_original, codigo_original,
      personal:personal_id(nombre)
    `)
    .eq("estado", "duplicado_sospechoso" as any)
    .eq("anulado", false)
    .order("timestamp_carga", { ascending: false });

  return (
    <div>
      <Topbar title="Duplicados Sospechosos" />
      <div className="p-6 space-y-4">
        <div className="flex items-start gap-3 bg-amber-bg border border-amber/40 rounded-[10px] px-4 py-3 text-[12px] text-amber-text">
          <i className="ti ti-alert-triangle text-[16px] mt-0.5 shrink-0" />
          <div>
            <strong>Duplicados sospechosos:</strong> registros con cadete, veterinaria, código, fecha y muestras coincidentes en ventana ≤30 min. No bloqueados automáticamente — requieren revisión.
          </div>
        </div>

        <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
          <div className="table-scroll">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-gy50">
                  {["ID", "Personal", "Veterinaria", "Fecha/hora", "Muestras", "Importe", "Posible dup. de", "Acciones"].map((h) => (
                    <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-gy400 border-b border-gy200 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(duplicados ?? []).map((r) => (
                  <tr key={r.id} className="hover:bg-gy50 border-b border-gy100 last:border-0">
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-red-500 font-medium">{r.id.slice(0, 8).toUpperCase()}</td>
                    <td className="px-3.5 py-2.5 font-medium text-gy900">{(r.personal as any)?.nombre ?? "—"}</td>
                    <td className="px-3.5 py-2.5">{r.veterinaria_texto_original}</td>
                    <td className="px-3.5 py-2.5 text-gy600">{formatDateTime(r.timestamp_carga)}</td>
                    <td className="px-3.5 py-2.5 text-center font-semibold">{r.cantidad_muestras}</td>
                    <td className="px-3.5 py-2.5">{fmtMoneySign(r.importe_declarado)}</td>
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-red-500">—</td>
                    <td className="px-3.5 py-2.5">
                      <DuplicadoActions retiroId={r.id} />
                    </td>
                  </tr>
                ))}
                {!duplicados?.length && (
                  <tr><td colSpan={8} className="py-10 text-center text-gy400">Sin duplicados detectados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
