import { redirect } from "next/navigation";
import { getMyProfile } from "@/lib/supabase/server";
import { Topbar } from "@/components/layout/Topbar";
import { NuevoPedidoForm } from "@/components/forms/NuevoPedidoForm";
import { PillStatus } from "@/components/ui/PillStatus";

export default async function NuevoPedidoPage() {
  const { user, profile } = await getMyProfile();
  if (!user) redirect("/login");

  // Solo el jefe de logística (o dirección) puede crear pedidos.
  const canCreate = ["jefe_logistica", "super_admin", "dueno"].includes(profile?.rol ?? "");
  if (!canCreate) redirect("/pedidos");

  return (
    <div>
      <Topbar title="Nuevo Pedido de Retiro" />
      <div className="p-6">
        <div className="grid grid-cols-[1fr_320px] gap-4 items-start">
          <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gy100 bg-g50 flex items-center gap-2.5">
              <i className="ti ti-circle-plus text-[20px] text-g700" />
              <span className="text-[14px] font-semibold flex-1">Datos del pedido</span>
              <PillStatus variant="asignado" />
            </div>
            <div className="p-5">
              <NuevoPedidoForm creadoPorId={profile!.id} />
            </div>
          </div>

          <div className="space-y-3.5">
            <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
              <div className="px-4 py-3.5 border-b border-gy100 flex items-center gap-2">
                <i className="ti ti-info-circle text-g600" />
                <span className="text-[14px] font-semibold">Cómo funciona</span>
              </div>
              <div className="p-4 space-y-2 text-[12px] text-gy600">
                <p>El pedido se asigna a un personal de logística y queda en estado <strong>Asignado</strong>.</p>
                <p>Si no se resuelve antes de la fecha límite, pasa a <strong>Vencido</strong> y se reasigna automáticamente.</p>
                <p>Cuando el cadete registra el retiro, el pedido se marca como <strong>Resuelto</strong>.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
