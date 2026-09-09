"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/ToastNotification";

interface Props {
  retiroId: string;
}

export function DuplicadoActions({ retiroId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<"confirmar" | "anular" | null>(null);

  async function resolver(accion: "confirmar" | "anular") {
    if (accion === "anular" && !confirm("¿Descartar este retiro por ser un duplicado?\n\nNo se elimina: queda anulado (no suma a las muestras ni a los totales) y sale de las bandejas, pero el registro se conserva.")) return;
    setLoading(accion);
    const res = await fetch("/api/retiros/duplicados/resolver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: retiroId, accion }),
    });
    const json = await res.json().catch(() => ({}));
    setLoading(null);

    if (!res.ok) { toast("error", json.error ?? "No se pudo resolver"); return; }
    if (json.yaResuelto) { toast("info", "Otro usuario ya lo resolvió"); window.dispatchEvent(new Event("badges:refresh")); router.refresh(); return; }

    toast(accion === "confirmar" ? "success" : "warning",
      accion === "confirmar" ? "Retiro confirmado como válido ✓" : "Duplicado descartado ✓");
    window.dispatchEvent(new Event("badges:refresh"));
    router.refresh();
  }

  return (
    <div className="flex gap-1.5">
      <button
        onClick={() => resolver("confirmar")}
        disabled={loading !== null}
        title="Es un retiro válido, no es duplicado"
        className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-g50 text-g700 border border-g200 rounded-[6px] hover:bg-g100 disabled:opacity-50"
      >
        <i className="ti ti-check text-[13px]" /> Confirmar
      </button>
      <button
        onClick={() => resolver("anular")}
        disabled={loading !== null}
        title="Es un duplicado real: no se elimina, queda anulado (sin sumar a totales)"
        className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-red-50 text-red-700 border border-red-200 rounded-[6px] hover:bg-red-100 disabled:opacity-50"
      >
        <i className="ti ti-x text-[13px]" /> Descartar
      </button>
    </div>
  );
}
