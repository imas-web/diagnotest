import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Topbar } from "@/components/layout/Topbar";
import { DuplicadosList } from "@/components/forms/DuplicadosList";
import { RevertirConfirmados } from "@/components/forms/RevertirConfirmados";
import { landingPathForRole } from "@/lib/utils/roles";
import { todayISO } from "@/lib/utils/dates";

// Caché corta (10s); Confirmar/Descartar revalidan al instante.
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

  // Candidatos a "lo confirmé por error": retiros de días anteriores a hoy
  // (fecha_operativa) que volvieron a 'registrado' hace poco (últimas 6h) —
  // la firma típica de haber tocado "Confirmar" en vez de "Descartar" sobre
  // un lote de duplicados viejos. No toca retiros 'registrado' de siempre,
  // solo los tocados recientemente.
  const seisHorasAtras = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: candidatosRevertir } = await supabase
    .from("retiros")
    .select(`
      id, fecha_operativa, timestamp_carga, updated_at, cantidad_muestras, importe_declarado,
      veterinaria_texto_original, codigo_original,
      personal:personal_id(nombre)
    `)
    .eq("estado", "registrado" as any)
    .eq("anulado", false)
    .lt("fecha_operativa", todayISO())
    .gte("updated_at", seisHorasAtras)
    .order("updated_at", { ascending: false });

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

        <RevertirConfirmados candidatos={candidatosRevertir ?? []} />

        <DuplicadosList duplicados={duplicados ?? []} />
      </div>
    </div>
  );
}
