"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/ToastNotification";
import { PillStatus } from "@/components/ui/PillStatus";
import { fmtMoneySign } from "@/lib/utils/format";
import { formatDateTime } from "@/lib/utils/dates";

interface Gasto {
  id: string;
  descripcion: string;
  monto: number;
  tipo: string;
  estado: string;
  created_at: string;
  observacion_jefe: string | null;
  comprobante_url: string | null;
  personal: { nombre: string } | null;
}

export function GastosAuthClient({ gastos }: { gastos: Gasto[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [obsInputs, setObsInputs] = useState<Record<string, string>>({});
  const [obsOpen, setObsOpen] = useState<Record<string, boolean>>({});
  const [live, setLive] = useState(false);
  const [filtro, setFiltro] = useState<"todos" | "gastos" | "retiros" | "observados" | "personal">("todos");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Realtime: refresca el panel cuando un cadete carga / cambia un gasto
  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 400);
    };

    const channel = supabase
      .channel("gastos-autorizacion")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gastos" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            toast("info", "Nuevo gasto cargado por un cadete");
          }
          scheduleRefresh();
        }
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtro por tipo/estado. "personal" no filtra: agrupa la lista por cadete.
  const matchesFiltro = (g: Gasto) =>
    filtro === "gastos" ? g.tipo !== "retiro_dinero"
    : filtro === "retiros" ? g.tipo === "retiro_dinero"
    : filtro === "observados" ? g.estado === "observado"
    : true;
  const visibles = gastos.filter(matchesFiltro);

  function toggleCheck(id: string) {
    setChecked((c) => ({ ...c, [id]: !c[id] }));
  }
  function toggleAll(val: boolean) {
    const next: Record<string, boolean> = { ...checked };
    visibles.filter((g) => g.estado === "pendiente").forEach((g) => { next[g.id] = val; });
    setChecked(next);
  }

  async function autorizarSeleccionados() {
    const ids = Object.entries(checked).filter(([, v]) => v).map(([id]) => id);
    if (!ids.length) { toast("warning", "Seleccioná al menos un gasto"); return; }
    const { error } = await supabase.from("gastos").update({ estado: "autorizado" }).in("id", ids);
    if (error) { toast("error", "Error al autorizar"); return; }
    toast("success", `${ids.length} gasto${ids.length > 1 ? "s" : ""} autorizado${ids.length > 1 ? "s" : ""} ✓`);
    setChecked({});
    window.dispatchEvent(new Event("badges:refresh"));
    router.refresh();
  }

  async function observar(id: string) {
    const obs = obsInputs[id]?.trim();
    if (!obs) { toast("warning", "Ingresá el motivo de observación"); return; }
    const { error } = await supabase.from("gastos").update({ estado: "observado", observacion_jefe: obs }).eq("id", id);
    if (error) { toast("error", "Error"); return; }
    toast("warning", "Gasto observado");
    setObsOpen((o) => ({ ...o, [id]: false }));
    window.dispatchEvent(new Event("badges:refresh"));
    router.refresh();
  }

  const selectedCount = Object.values(checked).filter(Boolean).length;

  const renderRow = (g: Gasto) => {
    const isAuth = g.estado === "autorizado";
    const isObs = g.estado === "observado";
    const isChecked = !!checked[g.id];

    return (
      <div key={g.id} className={`flex items-center gap-3 px-4 py-3 transition-colors ${isAuth ? "bg-g50" : isObs ? "bg-red-50" : ""}`}>
        <div
          onClick={() => g.estado === "pendiente" && toggleCheck(g.id)}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 cursor-pointer transition-all text-[12px] ${isChecked ? "bg-g600 border-g600 text-white" : "border-gy300"}`}
        >
          {isChecked && "✓"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-gy900">{g.descripcion}</div>
          <div className="text-[11px] text-gy400 mt-0.5">
            {(g.personal as { nombre?: string } | null)?.nombre ?? "—"} · {g.tipo === "retiro_dinero" ? "Retiro de dinero" : "Gasto"} · {formatDateTime(g.created_at)}
          </div>
          {isObs && (
            <div className="mt-1.5 text-[11px] text-red-600 italic">Obs: {g.observacion_jefe}</div>
          )}
          {g.comprobante_url && (
            <a href={g.comprobante_url} target="_blank" rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-g700 hover:text-g800 hover:underline">
              <i className="ti ti-photo text-[13px]" /> Ver ticket
            </a>
          )}
          {obsOpen[g.id] && (
            <div className="flex gap-2 mt-2">
              <input
                className="flex-1 px-2.5 py-1.5 border border-red-200 rounded-[6px] text-[12px] bg-red-50 focus:outline-none focus:border-red-400"
                placeholder="Motivo de observación..."
                value={obsInputs[g.id] ?? ""}
                onChange={(e) => setObsInputs((x) => ({ ...x, [g.id]: e.target.value }))}
              />
              <button onClick={() => observar(g.id)} className="px-3 py-1.5 text-[12px] bg-amber-bg text-amber-text border border-amber/40 rounded-[6px]">
                Confirmar
              </button>
              <button onClick={() => setObsOpen((o) => ({ ...o, [g.id]: false }))} className="px-2 py-1.5 text-[12px] bg-white border border-gy200 rounded-[6px] text-gy600">
                Cancelar
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="text-[16px] font-bold text-g700">{fmtMoneySign(g.monto)}</div>
          <PillStatus variant={isAuth ? "autorizado" : isObs ? "observado" : "pendiente"} />
          {!isAuth && !isObs && !obsOpen[g.id] && (
            <button onClick={() => setObsOpen((o) => ({ ...o, [g.id]: true }))}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-amber-bg text-amber-text border border-amber/40 rounded-[6px] hover:bg-amber/10">
              <i className="ti ti-message text-[13px]" /> Observar
            </button>
          )}
        </div>
      </div>
    );
  };

  // Agrupado por cadete para la vista "Por personal".
  const grupos = (() => {
    const m = new Map<string, { nombre: string; rows: Gasto[]; total: number }>();
    for (const g of visibles) {
      const nombre = (g.personal as { nombre?: string } | null)?.nombre ?? "Sin nombre";
      if (!m.has(nombre)) m.set(nombre, { nombre, rows: [], total: 0 });
      const grp = m.get(nombre)!;
      grp.rows.push(g);
      grp.total += g.monto;
    }
    return Array.from(m.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {([["todos", "Todos"], ["gastos", "Gastos"], ["retiros", "Retiros"], ["observados", "Observados"], ["personal", "Por personal"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setFiltro(key)}
              className={`px-3 py-1.5 rounded-full border text-[11px] transition-all ${filtro === key ? "bg-g800 text-white border-g800" : "bg-white text-gy600 border-gy200 hover:border-g400 hover:text-g700"}`}>{label}</button>
          ))}
          <span className={`ml-1 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors ${live ? "bg-g50 text-g700 border-g200" : "bg-gy50 text-gy400 border-gy200"}`} title={live ? "Actualización en tiempo real activa" : "Conectando…"}>
            <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-g500 animate-pulse" : "bg-gy300"}`} />
            {live ? "En vivo" : "Conectando…"}
          </span>
        </div>
        <button onClick={autorizarSeleccionados}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-g50 text-g700 border border-g200 text-[12px] font-medium rounded-[6px] hover:bg-g100">
          <i className="ti ti-checks" /> Autorizar {selectedCount > 0 ? `(${selectedCount})` : "seleccionados"}
        </button>
      </div>

      <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gy100 flex items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] font-medium cursor-pointer">
            <input type="checkbox" className="w-4 h-4 cursor-pointer"
              onChange={(e) => toggleAll(e.target.checked)} />
            Seleccionar todos los pendientes
          </label>
          <span className="ml-auto text-[11px] text-gy400">{visibles.length} registro{visibles.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="divide-y divide-gy100">
          {visibles.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12px] text-gy400">No hay gastos para este filtro</div>
          ) : filtro === "personal" ? (
            grupos.map((grp) => (
              <div key={grp.nombre}>
                <div className="flex items-center gap-2 px-4 py-2 bg-gy50 border-b border-gy100">
                  <span className="text-[12px] font-semibold text-gy700">{grp.nombre}</span>
                  <span className="text-[10px] text-gy400">{grp.rows.length} ítem{grp.rows.length !== 1 ? "s" : ""}</span>
                  <span className="ml-auto text-[12px] font-bold text-g700">{fmtMoneySign(grp.total)}</span>
                </div>
                <div className="divide-y divide-gy100">{grp.rows.map(renderRow)}</div>
              </div>
            ))
          ) : (
            visibles.map(renderRow)
          )}
        </div>
      </div>
    </div>
  );
}
