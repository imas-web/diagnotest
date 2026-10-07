import { createClient } from "@/lib/supabase/server";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { PillStatus } from "@/components/ui/PillStatus";
import { fmtMoneySign, fmtMoney } from "@/lib/utils/format";
import { formatDateTime } from "@/lib/utils/dates";
import { GastoForm } from "@/components/forms/GastoForm";

export default async function GastosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: personal } = await supabase.from("personal").select("id").eq("profile_id", user!.id).single();

  const { data: gastos } = await supabase
    .from("gastos")
    .select("*")
    .eq("personal_id", personal?.id ?? "")
    .order("created_at", { ascending: false });

  const gastosTotal = gastos?.reduce((s, g) => s + g.monto, 0) ?? 0;
  const pendientes = gastos?.filter((g) => g.estado === "pendiente") ?? [];
  const autorizados = gastos?.filter((g) => g.estado === "autorizado").reduce((s, g) => s + g.monto, 0) ?? 0;

  const iconMap: Record<string, string> = { gasto: "ti-gas-station", retiro_dinero: "ti-cash", diferencia_caja: "ti-scale" };
  const iconBg: Record<string, string> = { gasto: "bg-purple-50 text-purple-600", retiro_dinero: "bg-amber-bg text-amber-text", diferencia_caja: "bg-blue-50 text-blue-600" };
  const tipoLabel: Record<string, string> = { retiro_dinero: "Retiro de dinero", diferencia_caja: "Diferencia de caja", gasto: "Gasto" };

  return (
    <div>
      <Topbar
        title="Mis Gastos y Retiros de Dinero"
        actions={<GastoForm personalId={personal?.id ?? ""} />}
      />
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-3 gap-3.5">
          <StatCard label="Gastos este mes" value={fmtMoneySign(gastosTotal)} accent="purple" sub="registrados por vos" />
          <StatCard label="Pendientes auth." value={pendientes.length} accent="warn" sub="esperando aprobación" />
          <StatCard label="Autorizados" value={fmtMoneySign(autorizados)} sub="este mes" />
        </div>

        {/* Filter chips */}
        <div className="flex gap-1.5">
          {["Todos", "Gastos", "Retiros de dinero", "Observados"].map((f, i) => (
            <button key={f} className={`px-3 py-1.5 rounded-full border text-[11px] transition-all ${i === 0 ? "bg-g800 text-white border-g800" : "bg-white text-gy600 border-gy200 hover:border-g400 hover:text-g700"}`}>
              {f}
            </button>
          ))}
        </div>

        <div className="space-y-2.5">
          {(gastos ?? []).map((g) => (
            <div key={g.id} className="bg-white rounded-[14px] border border-gy200 shadow-sm px-4 py-3.5 flex gap-3.5 items-start hover:shadow-md transition-shadow">
              <div className={`w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 text-[18px] border ${iconBg[g.tipo] ?? "bg-gy50 text-gy400 border-gy200"}`}>
                <i className={`ti ${iconMap[g.tipo] ?? "ti-receipt"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-gy900">{g.descripcion}</div>
                <div className="text-[11px] text-gy400 mt-0.5">{formatDateTime(g.created_at)} · {tipoLabel[g.tipo] ?? "Gasto"}</div>
                <div className="mt-1.5 flex gap-1.5 items-center flex-wrap">
                  <PillStatus variant={g.estado === "autorizado" ? "autorizado" : g.estado === "observado" ? "observado" : "pendiente"} />
                  {g.estado === "observado" && g.observacion_jefe && (
                    <span className="text-[11px] text-red-600 italic">&ldquo;{g.observacion_jefe}&rdquo;</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <div className="text-[18px] font-bold text-g700">{fmtMoneySign(g.monto)}</div>
                <div className="font-mono text-[10px] text-gy400">{g.id.slice(0, 8).toUpperCase()}</div>
                {g.estado === "observado" && (
                  <button className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-amber-bg text-amber-text border border-amber/40 rounded-[6px] hover:bg-amber/10">
                    <i className="ti ti-message text-[13px]" /> Responder
                  </button>
                )}
              </div>
            </div>
          ))}
          {!gastos?.length && (
            <div className="py-12 text-center text-gy400">Sin gastos registrados</div>
          )}
        </div>
      </div>
    </div>
  );
}
