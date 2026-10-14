import { redirect } from "next/navigation";
import { createClient, getMyProfile } from "@/lib/supabase/server";
import { Topbar } from "@/components/layout/Topbar";
import { RetiroForm } from "@/components/forms/RetiroForm";
import { PillStatus } from "@/components/ui/PillStatus";
import { formatDateTime } from "@/lib/utils/dates";

export default async function NuevoRetiroPage() {
  const { user, profile } = await getMyProfile();
  if (!user) redirect("/login");

  const supabase = await createClient();
  let personalId: string | undefined;
  if (profile?.rol === "personal_logistica") {
    const { data: personal } = await supabase
      .from("personal")
      .select("id")
      .eq("profile_id", user.id)
      .single();
    personalId = personal?.id;
  }

  return (
    <div>
      <Topbar title="Nuevo Retiro de Muestras" />
      <div className="p-6">
        <div className="grid grid-cols-[1fr_320px] gap-4 items-start">
          <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gy100 bg-g50 flex items-center gap-2.5">
              <i className="ti ti-circle-plus text-[20px] text-g700" />
              <span className="text-[14px] font-semibold flex-1">Datos del retiro</span>
              <PillStatus variant="registrado" />
            </div>
            <div className="p-5">
              <RetiroForm personalId={personalId} />
            </div>
          </div>

          <div className="space-y-3.5">
            <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
              <div className="px-4 py-3.5 border-b border-gy100 flex items-center gap-2">
                <i className="ti ti-info-circle text-g600" />
                <span className="text-[14px] font-semibold">Info del registro</span>
              </div>
              <div className="p-4 space-y-2 text-[12px]">
                {[
                  ["ID retiro", <span key="id" className="font-mono font-medium text-g700">RET-[auto]</span>],
                  ["Timestamp carga", <span key="ts" className="font-medium">{formatDateTime(new Date())}</span>],
                  ["Estado inicial", <PillStatus key="est" variant="registrado" />],
                  ["Preanalítica", <PillStatus key="pre" variant="pendiente" />],
                  ["Cobranzas", <PillStatus key="cob" variant="pendiente" />],
                ].map(([label, val]) => (
                  <div key={String(label)} className="flex justify-between items-center">
                    <span className="text-gy400">{label}</span>
                    {val}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
              <div className="px-4 py-3.5 border-b border-gy100 flex items-center gap-2">
                <i className="ti ti-shield-check text-g600" />
                <span className="text-[14px] font-semibold">Validaciones activas</span>
              </div>
              <div className="p-3 divide-y divide-gy100">
                {[
                  "Permite retiro con 0 muestras (confirma)",
                  "Importe numérico requerido",
                  "Detección de duplicados (mismo día)",
                  "Veterinaria: normalización automática",
                  "Auditoría de cambios",
                ].map((v) => (
                  <div key={v} className="flex items-center gap-2 py-1.5 text-[11px]">
                    <i className="ti ti-check text-g500 text-[14px]" />
                    {v}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
