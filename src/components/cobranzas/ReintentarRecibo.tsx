"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/ToastNotification";

export function ReintentarRecibo({ controlId, importe }: { controlId: string; importe: number }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);

  async function reintentar() {
    setCargando(true);
    const res = await fetch("/api/cobranzas/validar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ controlId, estado: "adjudicado", importeValidado: importe }),
    });
    const json = await res.json().catch(() => ({}));
    setCargando(false);
    if (!res.ok) { toast("error", json.error ?? "No se pudo reintentar"); return; }
    if (json.recibo?.ok) toast("success", "Recibo generado en Interpracsys ✓");
    else toast("error", json.recibo?.info ?? "Sigue fallando el recibo en Interpracsys");
    router.refresh();
  }

  return (
    <button type="button" onClick={reintentar} disabled={cargando}
      className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-full hover:bg-blue-100 disabled:opacity-50">
      {cargando
        ? <span className="w-2.5 h-2.5 border-2 border-blue-300 border-t-blue-700 rounded-full animate-spin" />
        : <i className="ti ti-refresh text-[11px]" />}
      Reintentar
    </button>
  );
}
