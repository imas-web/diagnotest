import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Topbar } from "@/components/layout/Topbar";
import { ObservadosList } from "@/components/preanalitica/ObservadosList";
import { landingPathForRole } from "@/lib/utils/roles";
import { adjuntarIndicacionesPedido } from "@/lib/preanalitica/indicacionesPedido";

// Caché corta (10s); cada acción revalida al instante vía revalidarPreanalitica().
export const revalidate = 10;

const ROLES_BANDEJA = ["preanalitica", "dueno", "super_admin"];

export default async function PreanaliticaObservadosPage() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await auth.from("profiles").select("rol").eq("id", user.id).single();
  if (!perfil || !ROLES_BANDEJA.includes(perfil.rol)) redirect(landingPathForRole(perfil?.rol));

  // Lectura con admin (service role): no depende de la sesión/RLS (evita el "0").
  const supabase = createAdminClient();

  // Mismos campos que la bandeja para que la tarjeta sea totalmente editable:
  // se puede ajustar controles, etiquetas, detalle, fotos y muestras, y luego
  // marcar "Controlado OK" (o volver a observar).
  const { data: controles } = await supabase
    .from("control_preanalitica")
    .select(`
      *,
      retiro:retiro_id(
        id, cantidad_muestras, comentarios, urgente, fecha_operativa, timestamp_carga,
        veterinaria_texto_original, codigo_original, comprobante_url, pedido_id,
        personal:personal_id(nombre)
      )
    `)
    .in("estado", ["observado", "rechazado"])
    .order("updated_at", { ascending: false });
  await adjuntarIndicacionesPedido(supabase, controles ?? []);

  return (
    <div>
      <Topbar title="Preanalítica — Observados" />
      <div className="p-6 space-y-4">
        <div className="flex items-start gap-3 bg-amber-bg border border-amber/40 rounded-[10px] px-4 py-3 text-[12px] text-amber-text">
          <i className="ti ti-info-circle text-[16px] mt-0.5 shrink-0" />
          <div>
            Ajustá lo que haga falta (controles, etiquetas, detalle, fotos o muestras) y luego marcá <strong>Controlado OK</strong>. Al resolverlo sale de esta lista.
          </div>
        </div>

        <ObservadosList controles={controles ?? []} esSuperAdmin={perfil.rol === "super_admin"} />
      </div>
    </div>
  );
}
