"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/ToastNotification";
import { PillStatus } from "@/components/ui/PillStatus";
import { fmtMoneySign } from "@/lib/utils/format";
import { formatDateTime } from "@/lib/utils/dates";
import { ResponsableSelector } from "@/components/preanalitica/ResponsableSelector";
import { AdjuntosPreanalitica } from "@/components/preanalitica/AdjuntosPreanalitica";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// etapa: en qué solapa de preanalítica se está mostrando la tarjeta.
//   "c1"  → Control 1 (primer paso)
//   "c2"  → Control 2 (ve el Control 1 en solo lectura, marca el segundo)
//   "obs" → Observados (edición completa para resolver)
type Etapa = "c1" | "c2" | "obs";

interface Props {
  control: AnyRecord;
  tipo: "pre" | "cob";
  etapa?: Etapa;
}

// Etiquetas que preanalítica puede marcar al controlar una muestra.
const ETIQUETAS_PRE = [
  "Tiene citología",
  "Tiene AMF",
  "Tiene cross match",
  "Tiene VITEK",
  "Tiene histopatología",
  "Tiene progesterona",
  "Urgente",
  "Es del mismo paciente",
  "Plata en bolsa",
  "Propietario",
  "Autovacuna",
  "Hemocultivo",
  "Anula",
  "Sin orden",
  "Muestra volcada",
] as const;

// Medio de pago lo define logística al cargar el retiro; cobranzas solo lo ve.
const METODO_PAGO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  mercado_pago: "Mercado Pago",
  mercadopago: "Mercado Pago",
};

export function ControlCard({ control, tipo, etapa = "obs" }: Props) {
  const router = useRouter();
  const retiro = control.retiro as AnyRecord;
  const personal = retiro?.personal as AnyRecord;
  const isUrgente = control.urgente || retiro?.urgente;

  const [ctrl1, setCtrl1] = useState(control.control_1 ?? "");
  const [ctrl2, setCtrl2] = useState(control.control_2 ?? "");
  // Valores ya persistidos en la base, para marcar en verde lo que está guardado.
  const [savedCtrl1, setSavedCtrl1] = useState(control.control_1 ?? "");
  const [savedCtrl2, setSavedCtrl2] = useState(control.control_2 ?? "");
  const [estado, setEstado] = useState(control.estado ?? "pendiente");
  const [detalle, setDetalle] = useState(control.detalle ?? "");
  const [detalle2, setDetalle2] = useState(control.detalle_2 ?? "");
  const [etiquetas, setEtiquetas] = useState<string[]>(control.etiquetas ?? []);
  const [responsable1, setResponsable1] = useState<string | null>(control.responsable_1 ?? null);
  const [responsable2, setResponsable2] = useState<string | null>(control.responsable_2 ?? null);
  const [saving, setSaving] = useState(false);
  const [savingEdicion, setSavingEdicion] = useState(false);
  const [savingDuplicado, setSavingDuplicado] = useState(false);

  // En Control 2 las etiquetas del Control 1 quedan bloqueadas (solo lectura);
  // el operador del segundo control puede agregar otras, pero no quitarlas.
  const etiquetasBase = etapa === "c2" ? (control.etiquetas ?? []) as string[] : [];

  // Muestras editables (solo preanalítica) con confirmación.
  const [muestras, setMuestras] = useState(String(retiro?.cantidad_muestras ?? ""));
  const [savingMuestras, setSavingMuestras] = useState(false);
  const yaObservado = control.estado === "observado";

  // Fotos adjuntas (solo preanalítica): se suben al bucket "comprobantes"
  // y se persiste el listado de URLs en control_preanalitica.fotos_urls.
  const [fotos, setFotos] = useState<string[]>(control.fotos_urls ?? []);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const fotoInput = useRef<HTMLInputElement>(null);
  const fotoCamInput = useRef<HTMLInputElement>(null);

  // Automatización de estado sugerido a partir de los controles.
  const sugerido = ctrl1 === "observar" || ctrl2 === "observar"
    ? "observado"
    : ctrl1 === "ok" && ctrl2 === "ok"
      ? "ok"
      : null;

  // Datos de preanalítica (control 1:1 vía retiro) — solo lectura para cobranzas.
  const pre = (Array.isArray(retiro?.control_preanalitica) ? retiro?.control_preanalitica[0] : retiro?.control_preanalitica) as AnyRecord | undefined;
  const preEtiquetas: string[] = pre?.etiquetas ?? [];
  const preDetalle: string = pre?.detalle ?? "";
  const preEstado: string = pre?.estado ?? "pendiente";
  const preComentario: string = pre?.comentario ?? "";
  const preFotos: string[] = pre?.fotos_urls ?? [];
  const preCancelado: boolean = !!pre?.cancelado;
  const preAnulado: boolean = preEtiquetas.some((e) => /anul/i.test(e));
  const preRojo: boolean = preCancelado || preAnulado;
  const PRE_ESTADO_LABEL: Record<string, string> = {
    pendiente: "Pendiente de control",
    ok: "Controlado OK",
    observado: "Observado",
    rechazado: "Rechazado",
  };

  // Código de veterinaria editable (preanalítica / cobranzas / super admin).
  // Si el retiro se cargó por nombre y no quedó código suelto, se usa el código
  // de la veterinaria maestra vinculada (join veterinaria_id) como respaldo, así
  // siempre se ve código + nombre sin importar cómo lo ingresó el cadete.
  const vetMaster = (retiro as { veterinaria?: { codigo?: string; nombre?: string } | null } | null)?.veterinaria ?? null;
  const [codigo, setCodigo] = useState(retiro?.codigo_original ?? vetMaster?.codigo ?? "");
  const [vetNombre, setVetNombre] = useState(retiro?.veterinaria_texto_original ?? vetMaster?.nombre ?? "");
  const [match, setMatch] = useState<null | boolean>(null);
  const [savingCodigo, setSavingCodigo] = useState(false);

  const toggleEtiqueta = (e: string) => {
    if (etiquetasBase.includes(e)) return; // bloqueada: viene del Control 1
    setEtiquetas((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
  };

  // Guardado de una etapa (Control 1 o Control 2). El estado destino se deriva
  // del control marcado, así un solo botón "Guardar" resuelve la etapa:
  //   Control 1 = OK       → queda 'pendiente' y avanza a la solapa Control 2
  //   Control 1 = Observar → 'observado'
  //   Control 2 = OK       → 'ok' (Controlado)
  //   Control 2 = Observar → 'observado'
  async function guardarEtapa() {
    const esC1 = etapa === "c1";
    const valor = esC1 ? ctrl1 : ctrl2;
    const responsable = esC1 ? responsable1 : responsable2;
    if (!valor) { toast("warning", `Marcá el Control ${esC1 ? "1" : "2"} (OK u Observar)`); return; }
    if (!responsable) { toast("warning", "Marcá quién hizo el control"); return; }

    const nuevoEstado = valor === "observar" ? "observado" : esC1 ? "pendiente" : "ok";
    setSaving(true);
    const res = await fetch("/api/preanalitica/validar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        controlId: control.id,
        estado: nuevoEstado,
        control1: ctrl1 || null,
        control2: ctrl2 || null,
        etiquetas,
        detalle: detalle || null,
        detalle2: detalle2 || null,
        responsable1: responsable1 || null,
        responsable2: responsable2 || null,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { toast("error", json.error ?? "Error al guardar"); return; }
    const msg = valor === "observar"
      ? "Pasó a Observados"
      : esC1 ? "Control 1 OK · pasa a Control 2 ✓" : "Controlado ✓";
    toast("success", msg);
    router.refresh();
  }

  // Guarda correcciones (etiquetas, detalle, responsable) SIN controlar: el
  // registro queda pendiente en la misma etapa (no marca OK ni Observado). Sirve
  // para corregir un dato mal cargado sin sacarlo de la bandeja.
  async function guardarEdicion() {
    setSavingEdicion(true);
    const res = await fetch("/api/preanalitica/validar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        controlId: control.id,
        estado: "pendiente",
        control1: control.control_1 ?? null,
        control2: control.control_2 ?? null,
        etiquetas,
        detalle: detalle || null,
        detalle2: detalle2 || null,
        responsable1: responsable1 || null,
        responsable2: responsable2 || null,
      }),
    });
    const json = await res.json();
    setSavingEdicion(false);
    if (!res.ok) { toast("error", json.error ?? "No se pudo guardar"); return; }
    toast("success", "Cambios guardados ✓");
    router.refresh();
  }

  // Envía el retiro al flujo de Duplicados (Retiros → Duplicados), donde ya
  // se puede Confirmar o Anular. Saca el control de Observados: el caso se
  // termina de resolver allá, no acá.
  async function marcarDuplicado() {
    if (!window.confirm("¿Marcar este retiro como duplicado?\n\nPasa a Retiros → Duplicados, donde se puede confirmar o anular. Sale de Observados.")) return;
    setSavingDuplicado(true);
    const res = await fetch("/api/preanalitica/marcar-duplicado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ controlId: control.id }),
    });
    const json = await res.json().catch(() => ({}));
    setSavingDuplicado(false);
    if (!res.ok) { toast("error", json.error ?? "No se pudo marcar como duplicado"); return; }
    toast("success", "Enviado a Retiros → Duplicados ✓");
    router.refresh();
  }

  async function guardarCodigo() {
    const nuevo = codigo.trim();
    if (nuevo === (retiro?.codigo_original ?? "").trim()) return; // sin cambios
    setSavingCodigo(true);
    const res = await fetch("/api/retiros/codigo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retiroId: retiro?.id, codigo: nuevo }),
    });
    const json = await res.json();
    setSavingCodigo(false);
    if (!res.ok) { toast("error", json.error ?? "No se pudo guardar el código"); return; }
    setMatch(json.matched);
    if (json.matched && json.veterinaria) {
      setVetNombre(json.veterinaria.nombre);
      toast("success", `Código vinculado a ${json.veterinaria.nombre}`);
    } else {
      toast("success", "Código guardado (sin coincidencia en el maestro)");
    }
  }

  async function guardarMuestras() {
    const nueva = parseInt(muestras, 10);
    const actual = retiro?.cantidad_muestras ?? null;
    if (muestras.trim() === "" || isNaN(nueva) || nueva === actual) {
      setMuestras(String(actual ?? "")); // revertir si quedó vacío/igual
      return;
    }
    if (!window.confirm(`¿Confirmás cambiar la cantidad de muestras de ${actual ?? "—"} a ${nueva}?\n\nEl cambio queda registrado en auditoría.`)) {
      setMuestras(String(actual ?? ""));
      return;
    }
    setSavingMuestras(true);
    const res = await fetch("/api/retiros/muestras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retiroId: retiro?.id, cantidad: nueva }),
    });
    const json = await res.json();
    setSavingMuestras(false);
    if (!res.ok) { toast("error", json.error ?? "No se pudo guardar"); setMuestras(String(actual ?? "")); return; }
    if (retiro) retiro.cantidad_muestras = nueva;
    toast("success", "Cantidad de muestras actualizada ✓");
  }

  // Persiste el listado de fotos en la base (las URLs ya están en el storage).
  async function persistirFotos(nuevas: string[]) {
    const res = await fetch("/api/preanalitica/fotos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ controlId: control.id, fotos: nuevas }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast("error", json.error ?? "No se pudo guardar la foto");
      return false;
    }
    return true;
  }

  async function adjuntarFotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setSubiendoFoto(true);
    const supabase = createClient();
    const subidas: string[] = [];
    for (const file of Array.from(files)) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `preanalitica/${control.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("comprobantes").upload(path, file, {
        cacheControl: "3600", upsert: false, contentType: file.type || "image/jpeg",
      });
      if (error) { toast("error", "No se pudo subir: " + error.message); continue; }
      subidas.push(supabase.storage.from("comprobantes").getPublicUrl(path).data.publicUrl);
    }
    if (subidas.length) {
      const nuevas = [...fotos, ...subidas];
      const ok = await persistirFotos(nuevas);
      if (ok) { setFotos(nuevas); toast("success", `${subidas.length} foto(s) adjuntada(s) ✓`); }
    }
    setSubiendoFoto(false);
    if (fotoInput.current) fotoInput.current.value = "";
    if (fotoCamInput.current) fotoCamInput.current.value = "";
  }

  async function quitarFoto(url: string) {
    const nuevas = fotos.filter((f) => f !== url);
    const ok = await persistirFotos(nuevas);
    if (ok) setFotos(nuevas);
  }

  async function save(newEstado: string) {
    // Automatización: si los controles indican observación pero se fuerza "ok", avisar.
    if (tipo === "pre" && newEstado === "ok" && sugerido === "observado") {
      if (!window.confirm("Hay un control marcado como OBSERVAR.\n\n¿Seguro que querés forzar el estado a «Controlado OK»?")) return;
    }
    setSaving(true);

    if (tipo === "cob") {
      // Cobranzas pasa por la API: setea responsable y registra en auditoría.
      const res = await fetch("/api/cobranzas/validar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          controlId: control.id,
          estado: newEstado,
          // El monto no se valida en cobranzas; se adjudica el declarado para no generar diferencias.
          importeValidado: Number(retiro?.importe_declarado) || 0,
          detalle: detalle || null,
        }),
      });
      const json = await res.json();
      setSaving(false);
      if (!res.ok) { toast("error", json.error ?? "Error al guardar"); return; }
      toast("success", "Cobranza guardada ✓");
      router.refresh();
      return;
    }

    const res = await fetch("/api/preanalitica/validar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        controlId: control.id,
        estado: newEstado,
        control1: ctrl1 || null,
        control2: ctrl2 || null,
        etiquetas,
        detalle: detalle || null,
        detalle2: detalle2 || null,
        responsable1: responsable1 || null,
        responsable2: responsable2 || null,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { toast("error", json.error ?? "Error al guardar"); return; }
    // Confirmamos lo que quedó persistido para resaltarlo en verde.
    setSavedCtrl1(ctrl1);
    setSavedCtrl2(ctrl2);
    toast("success", "Control guardado ✓");
    router.refresh();
  }

  return (
    <div className={`bg-white rounded-[14px] border border-gy200 shadow-sm overflow-hidden hover:shadow-md transition-shadow ${isUrgente ? "border-l-4 border-l-red-500" : ""}`}>
      {/* Header */}
      <div className="px-4 py-3 bg-gy50 border-b border-gy100 flex items-center gap-2.5 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wide text-gy400 font-semibold">Código</span>
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            onBlur={guardarCodigo}
            disabled={savingCodigo}
            placeholder="—"
            className="w-24 px-2 py-1 font-mono text-[12px] font-medium text-gy700 bg-white border border-gy200 rounded-[6px] focus:outline-none focus:border-g500 disabled:opacity-50"
          />
        </div>
        <span className="text-[14px] font-semibold text-gy900">{vetNombre || "—"}</span>
        {retiro?.segunda_visita && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-700 bg-orange-100 border border-orange-300 rounded-full px-2 py-0.5"
            title="El cadete registró otra visita de esta veterinaria el mismo día y la confirmó como visita real (no es un duplicado).">
            <i className="ti ti-repeat" /> 2ª visita
          </span>
        )}
        {tipo === "pre" && (
          <button type="button" onClick={marcarDuplicado} disabled={saving || savingDuplicado}
            title="Manda el retiro a Retiros → Duplicados para confirmar o anular"
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-[6px] border border-red-200 text-red-700 bg-white hover:bg-red-50 disabled:opacity-50">
            {savingDuplicado
              ? <span className="w-3 h-3 border-2 border-red-300 border-t-red-700 rounded-full animate-spin" />
              : <i className="ti ti-copy text-[12px]" />}
            Es duplicado
          </button>
        )}
        <span className="flex-1" />
        {match === true && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-g700 bg-g50 border border-g200 rounded-full px-2 py-0.5">
            <i className="ti ti-check" /> Vinculada
          </span>
        )}
        {match === false && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-text bg-amber-bg border border-amber/40 rounded-full px-2 py-0.5">
            <i className="ti ti-alert-triangle" /> Sin coincidencia
          </span>
        )}
        <span className="text-[11px] text-gy400">{personal?.nombre ?? "—"} · {retiro?.fecha_operativa ? formatDateTime(retiro.timestamp_carga) : ""}</span>
        {retiro?.comprobante_url && (
          <a href={retiro.comprobante_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-g700 hover:text-g800 hover:underline">
            <i className="ti ti-photo text-[13px]" /> Ver ticket
          </a>
        )}
        {tipo === "pre" && yaObservado && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-text bg-amber-bg border border-amber/40 rounded-full px-2 py-0.5">
            <i className="ti ti-flag-2" /> Observado · pendiente
          </span>
        )}
        {isUrgente && <PillStatus variant="urgente" />}
      </div>

      {/* Body */}
      <div className="px-4 py-4">
        <div className="flex gap-5 mb-4 flex-wrap">
          <div>
            <div className="text-[9px] uppercase tracking-wide text-gy400 font-semibold mb-0.5">
              {tipo === "pre" ? "Muestras" : "Importe decl."}
            </div>
            {tipo === "pre" ? (
              <input type="number" inputMode="numeric" min="0"
                value={muestras} disabled={savingMuestras}
                onChange={(e) => setMuestras(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={guardarMuestras}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                title="Editá la cantidad y confirmá el cambio"
                className="w-20 px-2 py-0.5 text-[22px] font-bold text-g700 bg-white border border-gy200 rounded-[6px] focus:outline-none focus:border-g500 disabled:opacity-50" />
            ) : (
              <div className="text-[22px] font-bold text-g700">{fmtMoneySign(retiro?.importe_declarado ?? 0)}</div>
            )}
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-gy400 font-semibold mb-0.5">Cadete</div>
            <div className="text-[13px] font-semibold text-gy900">{personal?.nombre ?? "—"}</div>
          </div>
          {tipo !== "cob" && retiro?.comentarios && (
            <div className="flex-1">
              <div className="text-[9px] uppercase tracking-wide text-gy400 font-semibold mb-0.5">Comentarios</div>
              <div className="text-[12px] text-gy600">{retiro.comentarios}</div>
            </div>
          )}
        </div>

        {/* Control 2: resumen en solo lectura de lo cargado en el Control 1 */}
        {tipo === "pre" && etapa === "c2" && (
          <div className="mb-3 rounded-[8px] border border-gy200 bg-gy50 px-3 py-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <i className="ti ti-clipboard-check text-[13px] text-g600" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gy500">Control 1 (ya realizado)</span>
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-g700 bg-g50 border border-g200 rounded-full px-2 py-0.5">
                <i className="ti ti-check" /> {savedCtrl1 === "ok" ? "OK" : savedCtrl1 || "—"}
                {control.responsable_1 ? ` · ${control.responsable_1}` : ""}
              </span>
            </div>
            {etiquetasBase.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {etiquetasBase.map((e) => (
                  <span key={e} className="px-2 py-0.5 rounded-full text-[11px] bg-white text-g700 border border-g200">{e}</span>
                ))}
              </div>
            )}
            {control.detalle
              ? <div className="text-[12px] text-gy700">{control.detalle}</div>
              : etiquetasBase.length === 0 && <div className="text-[12px] text-gy400 italic">Sin etiquetas ni observaciones en el Control 1</div>}
          </div>
        )}

        {/* Flujo por etapa (Control 1 / Control 2): un solo select + Guardar debajo */}
        {tipo === "pre" && etapa !== "obs" && (
          <div className="flex gap-5 mb-3 flex-wrap items-start">
            <div className="w-[180px]">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1">
                {etapa === "c1" ? "Control 1" : "Control 2"}
              </div>
              <select className="w-full px-2.5 py-1.5 border-2 border-gy200 rounded-[6px] text-[12px] bg-gy50 focus:outline-none focus:border-g500"
                value={etapa === "c1" ? ctrl1 : ctrl2}
                onChange={(e) => (etapa === "c1" ? setCtrl1(e.target.value) : setCtrl2(e.target.value))}>
                <option value="">— Seleccionar —</option>
                <option value="ok">OK</option>
                <option value="observar">Observar</option>
              </select>
              {/* Guardar inmediatamente debajo del desplegable del control */}
              <button onClick={guardarEtapa} disabled={saving || savingEdicion}
                className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-g700 text-white border border-g700 rounded-[6px] hover:bg-g800 disabled:opacity-50">
                {saving
                  ? <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <i className="ti ti-device-floppy text-[13px]" />}
                Guardar
              </button>
            </div>
            <div className="flex-1 min-w-[240px]">
              <ResponsableSelector
                value={etapa === "c1" ? responsable1 : responsable2}
                onChange={etapa === "c1" ? setResponsable1 : setResponsable2}
              />
            </div>
          </div>
        )}

        {/* Controls preanalítica (solo Observados): control 1 / control 2 / estado */}
        {tipo === "pre" && etapa === "obs" && (
          <div className="grid grid-cols-3 gap-2.5 mb-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1 flex items-center gap-1">
                Control 1
                {ctrl1 !== "" && ctrl1 === savedCtrl1 && (
                  <span className="inline-flex items-center gap-0.5 text-g600 normal-case tracking-normal font-medium"><i className="ti ti-check text-[11px]" />guardado</span>
                )}
              </div>
              <select className={`w-full px-2.5 py-1.5 border-2 rounded-[6px] text-[12px] focus:outline-none focus:border-g500 transition-colors ${ctrl1 !== "" && ctrl1 === savedCtrl1 ? "border-g300 bg-g50 text-g700 font-medium" : "border-gy200 bg-gy50"}`}
                value={ctrl1} onChange={(e) => setCtrl1(e.target.value)}>
                <option value="">— Seleccionar —</option>
                <option value="ok">OK</option>
                <option value="observar">Observar</option>
              </select>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1 flex items-center gap-1">
                Control 2
                {ctrl2 !== "" && ctrl2 === savedCtrl2 && (
                  <span className="inline-flex items-center gap-0.5 text-g600 normal-case tracking-normal font-medium"><i className="ti ti-check text-[11px]" />guardado</span>
                )}
              </div>
              <select className={`w-full px-2.5 py-1.5 border-2 rounded-[6px] text-[12px] focus:outline-none focus:border-g500 transition-colors ${ctrl2 !== "" && ctrl2 === savedCtrl2 ? "border-g300 bg-g50 text-g700 font-medium" : "border-gy200 bg-gy50"}`}
                value={ctrl2} onChange={(e) => setCtrl2(e.target.value)}>
                <option value="">— Seleccionar —</option>
                <option value="ok">OK</option>
                <option value="observar">Observar</option>
              </select>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1">Estado</div>
              <select className="w-full px-2.5 py-1.5 border-2 border-gy200 rounded-[6px] text-[12px] bg-gy50 focus:outline-none focus:border-g500"
                value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="pendiente">Pendiente</option>
                <option value="ok">Controlado OK</option>
                <option value="observado">Observado</option>
              </select>
            </div>
          </div>
        )}

        {/* Controls (solo cobranzas) */}
        {tipo === "cob" && (
          <>
            {preRojo && (
              <div className="mb-3 rounded-[8px] border border-red-300 bg-red-50 px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <i className="ti ti-ban text-[14px] text-red-600" />
                  <span className="text-[11px] font-bold uppercase tracking-wide text-red-700">
                    {preCancelado ? "Cancelado por preanalítica" : "Anulado"}
                  </span>
                </div>
                {preCancelado && pre?.cancelado_motivo && (
                  <div className="text-[12px] text-red-700 mt-1">Motivo: {pre.cancelado_motivo}</div>
                )}
              </div>
            )}
            {/* Observaciones de logística: el comentario que cargó el cadete al
                registrar el retiro. Cobranzas también necesita verlo. */}
            <div className="mb-3 rounded-[8px] border border-blue-200 bg-blue-50 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <i className="ti ti-notes text-[13px] text-blue-600" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">Observaciones de logística</span>
              </div>
              {retiro?.comentarios
                ? <div className="text-[12px] text-gy700">{retiro.comentarios}</div>
                : <div className="text-[12px] text-gy400 italic">Sin observaciones de logística</div>}
            </div>

            <div className="mb-3 rounded-[8px] border border-gy200 bg-gy50 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <i className="ti ti-clipboard-check text-[13px] text-g600" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gy500">Aclaraciones de preanalítica</span>
                <span className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full border ${preEstado === "ok" ? "bg-g50 text-g700 border-g200" : preEstado === "observado" ? "bg-amber-bg text-amber-text border-amber/40" : preEstado === "rechazado" ? "bg-red-50 text-red-700 border-red-200" : "bg-white text-gy500 border-gy200"}`}>
                  {PRE_ESTADO_LABEL[preEstado] ?? preEstado}
                </span>
                <span title="Adjuntos de preanalítica"><AdjuntosPreanalitica fotos={preFotos} /></span>
              </div>
              {preEtiquetas.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {preEtiquetas.map((e) => (
                    <span key={e} className="px-2 py-0.5 rounded-full text-[11px] bg-white text-g700 border border-g200">{e}</span>
                  ))}
                </div>
              )}
              {preDetalle
                ? <div className="text-[12px] text-gy700">{preDetalle}</div>
                : preEtiquetas.length === 0 && !preComentario && <div className="text-[12px] text-gy400 italic">Sin etiquetas ni comentarios de preanalítica</div>}
              {preComentario && (
                <div className="mt-1.5 flex items-start gap-1.5 text-[12px] text-gy700">
                  <i className="ti ti-message-2 text-[13px] text-g600 mt-0.5" />
                  <span>{preComentario}</span>
                </div>
              )}
            </div>

            {/* Cobranzas solo adjudica: la validación del monto se hace en Control de Caja. */}
            <div className="grid grid-cols-2 gap-2.5 mb-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1">Importe declarado</div>
                <div className="w-full px-2.5 py-1.5 border-2 border-gy100 rounded-[6px] text-[12px] bg-gy50 text-gy700 font-semibold">
                  {fmtMoneySign(retiro?.importe_declarado ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1">Medio de pago</div>
                <div className="w-full px-2.5 py-1.5 border-2 border-gy100 rounded-[6px] text-[12px] bg-gy50 text-gy600 capitalize">
                  {METODO_PAGO_LABEL[retiro?.metodo_pago as string] ?? "—"}
                </div>
              </div>
            </div>
          </>
        )}

        {tipo === "pre" && (
          <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1.5">
              Etiquetas{etapa === "c2" && <span className="ml-1 normal-case tracking-normal text-gy400 font-normal">(las del Control 1 quedan fijas; podés agregar más)</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ETIQUETAS_PRE.map((e) => {
                const on = etiquetas.includes(e);
                const locked = etiquetasBase.includes(e);
                return (
                  <button key={e} type="button" onClick={() => toggleEtiqueta(e)} disabled={locked}
                    title={locked ? "Etiqueta del Control 1 (no se puede quitar)" : undefined}
                    className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${on ? "bg-g700 text-white border-g700" : "bg-gy50 text-gy600 border-gy200 hover:border-g400 hover:text-g700"} ${locked ? "opacity-90 cursor-default" : ""}`}>
                    {locked ? <i className="ti ti-lock text-[11px] mr-1" /> : on && <i className="ti ti-check text-[11px] mr-1" />}{e}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tipo === "pre" && (
          <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1.5">Fotos adjuntas</div>
            <div className="flex flex-wrap gap-2 items-center">
              {fotos.map((url) => (
                <div key={url} className="relative group">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="Foto adjunta" className="w-16 h-16 object-cover rounded-[8px] border border-gy200" />
                  </a>
                  <button type="button" onClick={() => quitarFoto(url)}
                    title="Quitar foto"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-[11px] leading-none flex items-center justify-center shadow hover:bg-red-700">
                    <i className="ti ti-x" />
                  </button>
                </div>
              ))}
              {/* Cámara: en tablets/celulares abre directo la cámara para sacar la foto. */}
              <input ref={fotoCamInput} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => adjuntarFotos(e.target.files)} />
              {/* Archivo: galería o archivos del dispositivo (permite varias). */}
              <input ref={fotoInput} type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => adjuntarFotos(e.target.files)} />
              <button type="button" onClick={() => fotoCamInput.current?.click()} disabled={subiendoFoto}
                className="w-16 h-16 rounded-[8px] border-2 border-dashed border-gy200 text-gy400 hover:border-g400 hover:text-g600 flex flex-col items-center justify-center gap-0.5 disabled:opacity-50">
                {subiendoFoto
                  ? <span className="w-4 h-4 border-2 border-gy300 border-t-g600 rounded-full animate-spin" />
                  : <><i className="ti ti-camera text-[16px]" /><span className="text-[9px]">Cámara</span></>}
              </button>
              <button type="button" onClick={() => fotoInput.current?.click()} disabled={subiendoFoto}
                className="w-16 h-16 rounded-[8px] border-2 border-dashed border-gy200 text-gy400 hover:border-g400 hover:text-g600 flex flex-col items-center justify-center gap-0.5 disabled:opacity-50">
                <i className="ti ti-paperclip text-[16px]" /><span className="text-[9px]">Archivo</span>
              </button>
            </div>
          </div>
        )}

        <div className="mb-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gy400 mb-1">
            {etapa === "c2" ? "Observación del Control 2" : "Detalle / Observación"}
          </div>
          <div className="flex gap-2 items-start">
            <input type="text"
              className="flex-1 px-2.5 py-1.5 border-2 border-gy200 rounded-[6px] text-[12px] bg-gy50 focus:outline-none focus:border-g500"
              placeholder={tipo === "pre" ? "Describir si hay observación..." : "Observaciones de cobranza..."}
              value={etapa === "c2" ? detalle2 : detalle}
              onChange={(e) => (etapa === "c2" ? setDetalle2(e.target.value) : setDetalle(e.target.value))} />
            {/* Guarda etiquetas/detalle/responsable sin controlar (el registro
                queda pendiente, no pasa a Observado). Separado del botón
                "Guardar" de arriba para que no se confundan al tocarlos. */}
            {tipo === "pre" && etapa === "c2" && (
              <button onClick={guardarEdicion} disabled={saving || savingEdicion}
                title="Guarda las correcciones (etiquetas, detalle, responsable) sin marcar OK/Observar"
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-white text-g700 border border-g300 rounded-[6px] hover:bg-g50 disabled:opacity-50">
                {savingEdicion
                  ? <span className="w-3 h-3 border-2 border-g300 border-t-g600 rounded-full animate-spin" />
                  : <i className="ti ti-edit text-[13px]" />}
                Guardar cambios
              </button>
            )}
          </div>
        </div>

        {tipo === "pre" && etapa === "obs" && sugerido && (
          <div className={`mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border ${sugerido === "ok" ? "bg-g50 text-g700 border-g200" : "bg-amber-bg text-amber-text border-amber/40"}`}>
            <i className={`ti ${sugerido === "ok" ? "ti-circle-check" : "ti-alert-triangle"} text-[13px]`} />
            Estado sugerido: {sugerido === "ok" ? "Controlado OK" : "Observado"}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {tipo === "pre" && etapa === "obs" && (
            <button onClick={() => save("pendiente")} disabled={saving}
              title="Guarda el avance sin finalizar."
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-gy50 text-gy700 border border-gy200 rounded-[6px] hover:bg-gy100 disabled:opacity-50">
              <i className="ti ti-device-floppy text-[13px]" /> Guardar
            </button>
          )}
          {(tipo === "cob" || (tipo === "pre" && etapa === "obs")) && (
            <button onClick={() => save(tipo === "pre" ? "ok" : "adjudicado")} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-g50 text-g700 border border-g200 rounded-[6px] hover:bg-g100 disabled:opacity-50">
              <i className="ti ti-check text-[13px]" />
              {tipo === "pre" ? "Controlado OK" : "Adjudicado OK"}
            </button>
          )}
          {tipo === "pre" && etapa === "obs" && (
            <button onClick={() => save("observado")} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-amber-bg text-amber-text border border-amber/40 rounded-[6px] hover:bg-amber/10 disabled:opacity-50">
              <i className="ti ti-eye text-[13px]" /> Observar
            </button>
          )}
          <span className="ml-auto text-[10px] text-gy400">
            {new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>
    </div>
  );
}
