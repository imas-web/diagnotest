"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ControlCard } from "@/components/ui/ControlCard";
import { ResponsableSelector } from "@/components/preanalitica/ResponsableSelector";
import { toast } from "@/components/ui/ToastNotification";
import { todayISO, daysAgoISO } from "@/lib/utils/dates";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

type Filtro = "fecha" | "personal" | "todos" | "urgentes" | "veterinaria";

const FILTROS: { id: Filtro; label: string }[] = [
  { id: "fecha", label: "Por fecha" },
  { id: "personal", label: "Por personal" },
  { id: "todos", label: "Todos" },
  { id: "urgentes", label: "Urgentes primero" },
  { id: "veterinaria", label: "Por veterinaria" },
];

type Etapa = "c1" | "c2";

const esUrgente = (c: AnyRecord) => c.urgente || c.retiro?.urgente;

// Etapa de cada control, derivada de control_1/control_2 (sin estados nuevos).
//   c1 → todavía no tiene el Control 1 en OK
//   c2 → Control 1 en OK, falta el Control 2
function etapaDe(c: AnyRecord): Etapa {
  return c.control_1 === "ok" ? "c2" : "c1";
}

// Encabezado legible para los grupos por fecha: "Hoy", "Ayer" o la fecha formateada.
// El "hoy/ayer" se compara contra la fecha de Buenos Aires (no la del navegador).
function etiquetaFecha(iso: string): string {
  if (!iso || iso === "Sin fecha") return "Sin fecha";
  if (iso === todayISO()) return "Hoy";
  if (iso === daysAgoISO(1)) return "Ayer";
  const [y, m, d] = iso.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long",
  });
}

// La barra "¿Quién controla?" se precarga con lo último que ESTA CUENTA marcó
// acá (localStorage, con clave por usuarioId) — no con lo que haya en la
// bandeja compartida ni con un "activo" global por etapa: eso hacía que, si
// preanalítica 2 marcaba a Soledad, a preanalítica 1/3/4 también les
// apareciera Soledad fija apenas abrían su propia bandeja. Se incluye el
// usuarioId en la clave (no solo la etapa) porque varias cuentas pueden
// compartir la misma compu/navegador a lo largo del día — sin eso, aunque
// cada una esté en su propia sesión, verían la selección de la cuenta
// anterior que usó ese mismo navegador.
function lsKey(etapa: Etapa, usuarioId: string): string {
  return `diagnotest_preanalitica_resp_${etapa}_${usuarioId}`;
}
function leerRespGuardado(etapa: Etapa, usuarioId: string): string | null {
  try {
    return localStorage.getItem(lsKey(etapa, usuarioId)) || null;
  } catch {
    return null;
  }
}
function guardarResp(etapa: Etapa, usuarioId: string, valor: string | null) {
  try {
    if (valor) localStorage.setItem(lsKey(etapa, usuarioId), valor);
    else localStorage.removeItem(lsKey(etapa, usuarioId));
  } catch {
    /* localStorage no disponible (ej. navegación privada) */
  }
}

export function PreanaliticaBandeja({ controles, usuarioId }: { controles: AnyRecord[]; usuarioId: string }) {
  const router = useRouter();
  const [etapa, setEtapa] = useState<Etapa>("c1");
  const [filtro, setFiltro] = useState<Filtro>("fecha");
  // Responsable por etapa (barra de "Quién controla"), personal de esta
  // cuenta: arranca vacío en el render del servidor (localStorage no existe
  // ahí) y se completa apenas monta, para no mezclar con el HTML de otra
  // sesión ni con lo que haya quedado de otra cuenta en este mismo navegador.
  const [respC1, setRespC1] = useState<string | null>(null);
  const [respC2, setRespC2] = useState<string | null>(null);
  useEffect(() => {
    setRespC1(leerRespGuardado("c1", usuarioId));
    setRespC2(leerRespGuardado("c2", usuarioId));
  }, [usuarioId]);
  const [aplicando, setAplicando] = useState(false);
  // Dos buscadores que filtran en vivo y se COMBINAN (acumulativos): mientras
  // haya algo escrito en "cadete", el filtro de veterinaria/código solo busca
  // dentro de ese cadete. El texto queda siempre visible (no se limpia solo),
  // así nunca se "pierde" un filtro al aplicar el otro.
  const [qCadete, setQCadete] = useState("");
  const [qVete, setQVete] = useState("");

  // En la bandeja solo se trabajan los pendientes; los observados tienen su
  // propia pantalla. Se reparten en dos solapas según la etapa del control.
  const pendientes = useMemo(() => controles.filter((c) => c.estado === "pendiente"), [controles]);
  const c1Count = useMemo(() => pendientes.filter((c) => etapaDe(c) === "c1").length, [pendientes]);
  const c2Count = useMemo(() => pendientes.filter((c) => etapaDe(c) === "c2").length, [pendientes]);

  const filtrados = useMemo(() => {
    const qc = qCadete.trim().toLowerCase();
    const qv = qVete.trim().toLowerCase();
    const base = pendientes.filter((c) => etapaDe(c) === etapa);
    if (!qc && !qv) return base;
    return base.filter((c) => {
      const r = c.retiro ?? {};
      const okCadete = !qc || String(r.personal?.nombre ?? "").toLowerCase().includes(qc);
      const etiquetas = Array.isArray(c.etiquetas) ? c.etiquetas : [];
      const okVete = !qv || [r.veterinaria_texto_original, r.codigo_original, ...etiquetas]
        .some((v) => String(v ?? "").toLowerCase().includes(qv));
      return okCadete && okVete;
    });
  }, [pendientes, qCadete, qVete, etapa]);

  // Lista plana ordenada (para "Todos" y "Urgentes primero").
  const planos = useMemo(() => {
    const arr = [...filtrados];
    if (filtro === "urgentes") {
      arr.sort((a, b) => Number(esUrgente(b)) - Number(esUrgente(a)));
    }
    return arr;
  }, [filtrados, filtro]);

  // Agrupación (para "Por fecha", "Por personal" y "Por veterinaria").
  const grupos = useMemo(() => {
    if (filtro !== "fecha" && filtro !== "personal" && filtro !== "veterinaria") return null;
    const key = (c: AnyRecord) =>
      filtro === "fecha"
        ? c.retiro?.fecha_operativa ?? "Sin fecha"
        : filtro === "personal"
          ? c.retiro?.personal?.nombre ?? "Sin asignar"
          : c.retiro?.veterinaria_texto_original ?? "Sin veterinaria";
    const map = new Map<string, AnyRecord[]>();
    for (const c of filtrados) {
      const k = key(c);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    const entries = Array.from(map.entries());
    // Por fecha: más reciente primero. Resto: alfabético.
    if (filtro === "fecha") return entries.sort((a, b) => b[0].localeCompare(a[0]));
    return entries.sort((a, b) => a[0].localeCompare(b[0], "es"));
  }, [filtrados, filtro]);

  const respActual = etapa === "c1" ? respC1 : respC2;
  const setRespState = etapa === "c1" ? setRespC1 : setRespC2;
  // Guarda en localStorage (personal de esta cuenta/navegador) cada vez que
  // se toca el selector, no solo al aplicar — así queda recordado aunque
  // todavía no se haya tocado "Aplicar a toda la bandeja".
  const etapaParaGuardar = etapa;
  const setRespActual = (v: string | null) => { setRespState(v); guardarResp(etapaParaGuardar, usuarioId, v); };
  const countActual = etapa === "c1" ? c1Count : c2Count;

  async function aplicarResponsable() {
    if (!(respActual ?? "").trim()) { toast("error", "Marcá al menos una persona"); return; }
    setAplicando(true);
    const res = await fetch("/api/preanalitica/responsable-masivo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: etapa, responsable: respActual }),
    });
    const json = await res.json().catch(() => ({}));
    setAplicando(false);
    if (!res.ok) { toast("error", json.error ?? "No se pudo aplicar"); return; }
    toast("success", `Responsable aplicado a ${json.actualizados ?? 0} registro(s) ✓`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Solapas por etapa: primero Control 1, después Control 2 */}
      <div className="flex gap-2 items-center">
        {([
          { id: "c1" as Etapa, label: "Control 1", icon: "ti-clipboard-list", count: c1Count },
          { id: "c2" as Etapa, label: "Control 2", icon: "ti-clipboard-check", count: c2Count },
        ]).map((t) => (
          <button key={t.id} onClick={() => setEtapa(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-[10px] border text-[13px] font-semibold transition-all ${etapa === t.id ? "bg-g800 text-white border-g800 shadow-sm" : "bg-white text-gy600 border-gy200 hover:border-g400 hover:text-g700"}`}>
            <i className={`ti ${t.icon} text-[16px]`} />
            {t.label}
            <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${etapa === t.id ? "bg-white/20 text-white" : "bg-gy100 text-gy600"}`}>{t.count}</span>
          </button>
        ))}
        {/* Refresco de un toque: trae los pendientes frescos del servidor. */}
        <button onClick={() => router.refresh()} title="Actualizar la bandeja"
          className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-[10px] border border-gy200 bg-white text-gy600 text-[12px] font-medium hover:border-g400 hover:text-g700">
          <i className="ti ti-refresh text-[15px]" /> Actualizar
        </button>
      </div>

      {/* Responsable global de la etapa: se marca una vez y se aplica a TODA la
          bandeja de Control 1 (o 2). Si cambian las personas y vuelven a aplicar,
          se re-estampa lo que sigue pendiente; lo ya controlado no se toca. */}
      <div className="bg-g50/60 border border-g700/20 rounded-[12px] p-3.5 space-y-2.5">
        <div className="flex items-center gap-2">
          <i className="ti ti-users text-g700 text-[15px]" />
          <span className="text-[13px] font-semibold text-g800">
            ¿Quién controla en {etapa === "c1" ? "Control 1" : "Control 2"}?
          </span>
          <span className="text-[11px] text-gy500">se aplica a los {countActual} registros de la bandeja</span>
        </div>
        <ResponsableSelector value={respActual} onChange={setRespActual} />
        <button type="button" onClick={aplicarResponsable} disabled={aplicando || countActual === 0}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-g800 text-white text-[12px] font-semibold rounded-[8px] hover:bg-g700 disabled:opacity-50">
          {aplicando
            ? <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            : <i className="ti ti-users-group text-[14px]" />}
          Aplicar a toda la bandeja ({etapa === "c1" ? "Control 1" : "Control 2"})
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[170px] max-w-[260px]">
          <i className="ti ti-user absolute left-3 top-1/2 -translate-y-1/2 text-gy400 text-[14px]" />
          <input
            type="text"
            value={qCadete}
            onChange={(e) => setQCadete(e.target.value)}
            placeholder="Filtrar por cadete…"
            className="w-full pl-8 pr-8 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500 focus:bg-white"
          />
          {qCadete && (
            <button type="button" onClick={() => setQCadete("")} title="Limpiar"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gy400 hover:text-gy700">
              <i className="ti ti-x text-[13px]" />
            </button>
          )}
        </div>
        <div className="relative flex-1 min-w-[170px] max-w-[260px]">
          <i className="ti ti-building-store absolute left-3 top-1/2 -translate-y-1/2 text-gy400 text-[14px]" />
          <input
            type="text"
            value={qVete}
            onChange={(e) => setQVete(e.target.value)}
            placeholder="Veterinaria, código o etiqueta…"
            className="w-full pl-8 pr-8 py-1.5 border-2 border-gy200 rounded-[8px] text-[12px] bg-gy50 focus:outline-none focus:border-g500 focus:bg-white"
          />
          {qVete && (
            <button type="button" onClick={() => setQVete("")} title="Limpiar"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gy400 hover:text-gy700">
              <i className="ti ti-x text-[13px]" />
            </button>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FILTROS.map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)}
              className={`px-3 py-1.5 rounded-full border text-[11px] transition-all ${filtro === f.id ? "bg-g800 text-white border-g800" : "bg-white text-gy600 border-gy200 hover:border-g400 hover:text-g700"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Indicador de filtros combinados (acumulativos): muestra ambos a la vez
          y permite limpiarlos juntos. */}
      {(qCadete.trim() || qVete.trim()) && (
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          <span className="text-gy400">Filtrando</span>
          {qCadete.trim() && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-g50 text-g700 border border-g700/30">
              <i className="ti ti-user text-[11px]" />{qCadete.trim()}
            </span>
          )}
          {qCadete.trim() && qVete.trim() && <span className="text-gy400">+</span>}
          {qVete.trim() && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-g50 text-g700 border border-g700/30">
              <i className="ti ti-building-store text-[11px]" />{qVete.trim()}
            </span>
          )}
          <button onClick={() => { setQCadete(""); setQVete(""); }}
            className="ml-1 text-gy500 hover:text-gy800 underline">Limpiar todo</button>
        </div>
      )}

      {!filtrados.length && (
        <div className="py-12 text-center text-gy400">
          {qCadete.trim() || qVete.trim() ? "Sin resultados para la búsqueda" : "Sin retiros pendientes de control"}
        </div>
      )}

      {grupos
        ? grupos.map(([nombre, items]) => (
            <div key={nombre} className="space-y-3.5">
              <div className="flex items-center gap-2 pt-1">
                {filtro === "fecha" && <i className="ti ti-calendar text-[13px] text-g600" />}
                <span className="text-[12px] font-semibold text-gy700 capitalize">
                  {filtro === "fecha" ? etiquetaFecha(nombre) : nombre}
                </span>
                <span className="text-[11px] text-gy400">({items.length})</span>
                <div className="flex-1 h-px bg-gy100" />
              </div>
              {items.map((c) => (
                <ControlCard key={c.id} control={c} tipo="pre" etapa={etapa} />
              ))}
            </div>
          ))
        : (
            <div className="space-y-3.5">
              {planos.map((c: AnyRecord) => (
                <ControlCard key={c.id} control={c} tipo="pre" etapa={etapa} />
              ))}
            </div>
          )}
    </div>
  );
}
