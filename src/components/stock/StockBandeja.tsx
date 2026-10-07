"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/ToastNotification";
import { cn } from "@/lib/utils/format";
import { formatDateTime } from "@/lib/utils/dates";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const fmtNum = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

export function StockBandeja({ articulos }: { articulos: AnyRecord[] }) {
  const router = useRouter();
  const [subiendo, setSubiendo] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [soloAlerta, setSoloAlerta] = useState(false);
  const [categoria, setCategoria] = useState("");
  const [conteoAbierto, setConteoAbierto] = useState<string | null>(null);
  const [conteoValor, setConteoValor] = useState("");
  const [guardandoConteo, setGuardandoConteo] = useState(false);

  const categorias = useMemo(
    () => Array.from(new Set(articulos.map((a) => a.categoria).filter(Boolean))).sort(),
    [articulos]
  );

  const filtrados = useMemo(() => {
    const term = q.trim().toLowerCase();
    return articulos.filter((a) => {
      const enAlerta = a.stock_sistema <= a.stock_minimo;
      if (soloAlerta && !enAlerta) return false;
      if (categoria && a.categoria !== categoria) return false;
      if (!term) return true;
      return [a.codigo, a.nombre, a.categoria].some((v) => String(v ?? "").toLowerCase().includes(term));
    });
  }, [articulos, q, soloAlerta, categoria]);

  async function subirArchivo(file: File) {
    setSubiendo(true);
    const form = new FormData();
    form.append("archivo", file);
    const res = await fetch("/api/stock/subir", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    setSubiendo(false);
    if (fileInput.current) fileInput.current.value = "";
    if (!res.ok) { toast("error", json.error ?? "No se pudo subir el archivo"); return; }
    toast("success", `${json.actualizados} artículo(s) actualizados ✓`);
    if (json.avisos?.length) toast("warning", json.avisos.join(" "));
    router.refresh();
  }

  async function guardarConteo(articuloId: string) {
    const valor = Number(conteoValor.replace(",", "."));
    if (!isFinite(valor) || valor < 0) { toast("error", "Ingresá un número válido"); return; }
    setGuardandoConteo(true);
    const res = await fetch("/api/stock/conteo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articuloId, stockReal: valor }),
    });
    const json = await res.json().catch(() => ({}));
    setGuardandoConteo(false);
    if (!res.ok) { toast("error", json.error ?? "No se pudo guardar el conteo"); return; }
    toast("success", "Conteo guardado ✓");
    setConteoAbierto(null);
    setConteoValor("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-[14px] border border-gy200 shadow-sm p-4 flex items-center gap-3 flex-wrap">
        <div>
          <div className="text-[13px] font-semibold text-gy900">Subir stock de Interpracsys</div>
          <div className="text-[11px] text-gy400">Excel exportado por sector o el listado completo (Código, Nombre, Stock, Stock Mín.)</div>
        </div>
        <input ref={fileInput} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) subirArchivo(f); }} />
        <button type="button" onClick={() => fileInput.current?.click()} disabled={subiendo}
          className="ml-auto flex items-center gap-1.5 px-3.5 py-2 bg-g800 text-white text-[12px] font-semibold rounded-[8px] hover:bg-g700 disabled:opacity-50">
          {subiendo
            ? <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            : <i className="ti ti-file-upload text-[14px]" />}
          Subir archivo
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gy400 text-[14px]" />
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por código o nombre…"
            className="w-full pl-8 pr-3 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500 focus:bg-white" />
        </div>
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)}
          className="px-3 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500">
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" onClick={() => setSoloAlerta((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-medium transition-colors",
            soloAlerta ? "bg-red-50 text-red-700 border-red-200" : "bg-white text-gy600 border-gy200 hover:border-g400"
          )}>
          <i className="ti ti-alert-triangle text-[13px]" /> Solo en mínimo
        </button>
      </div>

      <div className="bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-gy50 border-b border-gy100 text-[10px] uppercase tracking-wide text-gy400 font-semibold">
              <th className="px-3 py-2 text-left">Código</th>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-left">Categoría</th>
              <th className="px-3 py-2 text-right">Stock sistema</th>
              <th className="px-3 py-2 text-right">Mínimo</th>
              <th className="px-3 py-2 text-right">Stock real</th>
              <th className="px-3 py-2 text-right">Diferencia</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {!filtrados.length && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-gy400">Sin artículos para mostrar</td></tr>
            )}
            {filtrados.map((a) => {
              const enAlerta = a.stock_sistema <= a.stock_minimo;
              const tieneConteo = a.stock_real !== null;
              const diferencia = tieneConteo ? a.stock_real - a.stock_sistema : null;
              return (
                <tr key={a.id} className={cn("border-b border-gy100 last:border-0", enAlerta && "bg-red-50/50")}>
                  <td className="px-3 py-2 font-mono text-[11px] text-gy700">{a.codigo}</td>
                  <td className="px-3 py-2 text-gy900">{a.nombre}</td>
                  <td className="px-3 py-2 text-gy500">{a.categoria ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gy900">{fmtNum(a.stock_sistema)}</td>
                  <td className="px-3 py-2 text-right text-gy500">{fmtNum(a.stock_minimo)}</td>
                  <td className="px-3 py-2 text-right">
                    {tieneConteo
                      ? <span className="font-semibold text-gy900">{fmtNum(a.stock_real)}</span>
                      : <span className="text-gy300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {diferencia !== null && diferencia !== 0 && (
                      <span className={cn("font-semibold", diferencia < 0 ? "text-red-600" : "text-amber-text")}>
                        {diferencia > 0 ? "+" : ""}{fmtNum(diferencia)}
                      </span>
                    )}
                    {diferencia === 0 && <span className="text-g600"><i className="ti ti-check" /></span>}
                    {diferencia === null && <span className="text-gy300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {enAlerta && (
                      <span title="Stock en o por debajo del mínimo" className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-100 border border-red-200 rounded-full px-2 py-0.5 mr-1.5">
                        <i className="ti ti-alert-triangle text-[11px]" /> Mínimo
                      </span>
                    )}
                    {conteoAbierto === a.id ? (
                      <span className="inline-flex items-center gap-1">
                        <input type="text" autoFocus value={conteoValor}
                          onChange={(e) => setConteoValor(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") guardarConteo(a.id); if (e.key === "Escape") setConteoAbierto(null); }}
                          placeholder="Stock real"
                          className="w-20 px-2 py-1 border-2 border-g300 rounded-[6px] text-[12px] text-right focus:outline-none focus:border-g500" />
                        <button type="button" onClick={() => guardarConteo(a.id)} disabled={guardandoConteo}
                          className="px-2 py-1 bg-g700 text-white rounded-[6px] text-[11px] font-medium hover:bg-g800 disabled:opacity-50">
                          <i className="ti ti-check text-[12px]" />
                        </button>
                        <button type="button" onClick={() => setConteoAbierto(null)}
                          className="px-2 py-1 text-gy400 hover:text-gy700">
                          <i className="ti ti-x text-[12px]" />
                        </button>
                      </span>
                    ) : (
                      <button type="button"
                        onClick={() => { setConteoAbierto(a.id); setConteoValor(a.stock_real !== null ? String(a.stock_real) : ""); }}
                        title={a.stock_real_actualizado_at ? `Último conteo: ${formatDateTime(a.stock_real_actualizado_at)}` : "Todavía sin conteo real"}
                        className="px-2 py-1 text-[11px] font-medium text-g700 border border-g200 rounded-[6px] hover:bg-g50">
                        <i className="ti ti-clipboard-list text-[12px]" /> Contar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
