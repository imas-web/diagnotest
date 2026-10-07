import { createClient } from "@/lib/supabase/server";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { fmtMoneySign, fmtMoney } from "@/lib/utils/format";
import { formatDateTime } from "@/lib/utils/dates";
import { GastosAuthClient } from "@/components/forms/GastosAuthClient";

export default async function GastosAutorizarPage() {
  const supabase = await createClient();

  // "Diferencia de caja" no es un gasto a reembolsar — es la nota del cadete
  // sobre un faltante/sobrante de efectivo, que Dirección revisa en Control
  // de Caja, no algo que el jefe de logística tenga que autorizar.
  const { data: gastos } = await supabase
    .from("gastos")
    .select(`*, personal:personal_id(nombre)`)
    .neq("tipo", "diferencia_caja")
    .order("created_at", { ascending: false });

  const pendientes = gastos?.filter((g) => g.estado === "pendiente") ?? [];
  const observados = gastos?.filter((g) => g.estado === "observado") ?? [];
  const autorizados = gastos?.filter((g) => g.estado === "autorizado") ?? [];
  const montoPendiente = pendientes.reduce((s, g) => s + g.monto, 0);
  const montoAutorizado = autorizados.reduce((s, g) => s + g.monto, 0);

  return (
    <div>
      <Topbar title="Gastos — Autorización" />
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-4 gap-3.5">
          <StatCard label="Pendientes auth." value={pendientes.length} accent="purple" />
          <StatCard label="Monto pendiente" value={fmtMoneySign(montoPendiente)} accent="warn" />
          <StatCard label="Autorizados hoy" value={fmtMoneySign(montoAutorizado)} />
          <StatCard label="Observados" value={observados.length} accent="danger" />
        </div>

        <GastosAuthClient gastos={gastos ?? []} />
      </div>
    </div>
  );
}
