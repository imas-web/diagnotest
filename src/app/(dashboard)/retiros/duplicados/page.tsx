import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Topbar } from "@/components/layout/Topbar";
import { DuplicadosList } from "@/components/forms/DuplicadosList";
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

        <DuplicadosList duplicados={duplicados ?? []} />
      </div>
    </div>
  );
}
