"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useOffline } from "@/lib/hooks/useOffline";
import { useSync } from "@/lib/hooks/useSync";
import { saveRetiroOffline, addToSyncQueue, getRetirosOffline } from "@/lib/offline/indexeddb";
import { toast } from "@/components/ui/ToastNotification";
import { todayISO, nowISO, formatDateTime } from "@/lib/utils/dates";
import { initials, fmtMoneySign } from "@/lib/utils/format";
import { notificarNuevoPedido, pedirPermisoNotificaciones } from "@/lib/utils/notificaciones";
import { normVet } from "@/lib/pedidos/match";
import type { MetodoPago } from "@/types";
import type { PedidoMobile, RetiroResumen } from "@/app/(dashboard)/inicio/page";

interface VetOption { id: string; codigo: string; nombre: string; telefono: string | null; direccion: string | null }

interface Props {
  nombre: string;
  zonaNombre: string;
  personalId: string;
  profileId: string;
  veterinarias: VetOption[];
  pedidos: PedidoMobile[];
  retirosHoy: RetiroResumen[];
  totalGastosHoy: number;
}

type Tab = "resumen" | "retiro" | "pedidos" | "gastos";

export function MobileHome({ nombre, zonaNombre, personalId, profileId, veterinarias, pedidos, retirosHoy, totalGastosHoy }: Props) {
  const router = useRouter();
  const { isOffline } = useOffline();
  // El layout del cadete no monta Topbar/DashboardShell, así que la cola de
  // sincronización se dispara desde acá: al reconectarse (o al abrir la app ya
  // online) se sube todo lo que quedó pendiente offline.
  const { pendingCount, isSyncing, lastSynced, sync } = useSync();
  const supabase = createClient();

  const [tab, setTab] = useState<Tab>("resumen");
  const [bannerOpen, setBannerOpen] = useState(pedidos.length > 0);
  const [verVets, setVerVets] = useState(false);

  // Retiros offline del día (aún sin sincronizar) — se suman al resumen del servidor.
  const [retirosOfflineHoy, setRetirosOfflineHoy] = useState<RetiroResumen[]>([]);
  useEffect(() => {
    if (!personalId) return;
    let activo = true;
    getRetirosOffline(personalId).then((rows) => {
      if (!activo) return;
      const hoy = todayISO();
      const mapped = (rows ?? [])
        .filter((r) => r.fecha_operativa === hoy)
        .map((r) => ({
          id: r.id,
          veterinaria: r.veterinaria_texto_original ?? "Veterinaria",
          codigo: r.codigo_original ?? "",
          importe: Number(r.importe_declarado ?? 0),
          muestras: Number(r.cantidad_muestras ?? 0),
        }));
      setRetirosOfflineHoy(mapped);
    });
    return () => { activo = false; };
  }, [personalId, isOffline]);

  // Combina servidor + offline sin duplicar por id.
  const resumenRetiros = useMemo(() => {
    const ids = new Set(retirosHoy.map((r) => r.id));
    return [...retirosHoy, ...retirosOfflineHoy.filter((r) => !ids.has(r.id))];
  }, [retirosHoy, retirosOfflineHoy]);

  const totalVisitas = resumenRetiros.length;
  const totalImporte = resumenRetiros.reduce((s, r) => s + r.importe, 0);
  const totalMuestras = resumenRetiros.reduce((s, r) => s + r.muestras, 0);
  // Efectivo esperado = lo cobrado en EFECTIVO (no transferencia/Mercado Pago)
  // menos los gastos del día — así el cadete lo compara directo contra lo que
  // cuenta en la mano, sin tener que hacer la resta solo. Los retiros offline
  // sin sincronizar no traen método de pago todavía, así que no suman acá
  // hasta que se sincronicen.
  const totalEfectivoHoy = resumenRetiros.reduce((s, r) => s + (r.metodoPago === "efectivo" ? r.importe : 0), 0);
  const efectivoEsperadoHoy = totalEfectivoHoy - totalGastosHoy;

  // Realtime: cuando el jefe asigna un pedido a este cadete, el perfil se
  // actualiza solo (sin recargar) y avisa con vibración + sonido + notificación.
  useEffect(() => {
    if (!personalId) return;
    pedirPermisoNotificaciones();
    const channel = supabase
      .channel(`pedidos-cadete-${personalId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pedidos_retiro", filter: `personal_asignado_id=eq.${personalId}` },
        () => {
          notificarNuevoPedido();
          toast("info", "📍 Nuevo pedido de retiro asignado");
          router.refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "pedidos_retiro", filter: `personal_asignado_id=eq.${personalId}` },
        () => router.refresh()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personalId]);

  // Al terminar de subir la cola pendiente, avisa y refresca el resumen.
  useEffect(() => {
    if (lastSynced && lastSynced > 0) {
      toast("success", `${lastSynced} registro${lastSynced > 1 ? "s" : ""} sincronizado${lastSynced > 1 ? "s" : ""} ✓`);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSynced]);

  // ── Retiro form ─────────────────────────────────────────────
  const [vetTexto, setVetTexto] = useState("");
  const [vetId, setVetId] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [muestras, setMuestras] = useState("");
  const [importe, setImporte] = useState("0");
  const [metodoPago, setMetodoPago] = useState<MetodoPago | "">("");
  const [comentarios, setComentarios] = useState("");
  const [urgente, setUrgente] = useState(false);
  const [pedidoId, setPedidoId] = useState<string | null>(null);
  // Si está seteado, el formulario edita un retiro existente (en vez de crear).
  const [editId, setEditId] = useState<string | null>(null);
  const [savingRetiro, setSavingRetiro] = useState(false);
  const [fotoRetiro, setFotoRetiro] = useState<File | null>(null);
  const fotoRetiroInput = useRef<HTMLInputElement>(null);
  // Avisos que requieren confirmación antes de guardar (modal propio: en la PWA
  // instalada el window.confirm nativo suele quedar suprimido por el navegador).
  // `dup` indica si entre los avisos hay un duplicado confirmado, para que el
  // retiro guardado quede como visita válida y no oculto como sospechoso.
  const [confirmRetiro, setConfirmRetiro] = useState<{ msgs: string[]; dup: boolean } | null>(null);

  // ── Gasto form ──────────────────────────────────────────────
  const [gTipo, setGTipo] = useState<"gasto" | "retiro_dinero" | "diferencia_caja">("gasto");
  const [gDesc, setGDesc] = useState("");
  const [gMonto, setGMonto] = useState("");
  const [gSigno, setGSigno] = useState<"falta" | "sobra" | "ok">("falta");
  const [gFecha, setGFecha] = useState(todayISO());
  const [savingGasto, setSavingGasto] = useState(false);
  const [fotoGasto, setFotoGasto] = useState<File | null>(null);
  const fotoGastoInput = useRef<HTMLInputElement>(null);

  // Sube una foto al bucket "comprobantes" y devuelve la URL pública
  async function uploadComprobante(file: File): Promise<string | null> {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${personalId || "anon"}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("comprobantes").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/jpeg",
    });
    if (error) { toast("error", "No se pudo subir la foto: " + error.message); return null; }
    return supabase.storage.from("comprobantes").getPublicUrl(path).data.publicUrl;
  }

  function matchVet(value: string) {
    setVetTexto(value);
    const val = value.trim();
    const valNorm = normVet(val);
    // Coincidencia por valor combinado "código — nombre", por código o por nombre.
    // Se normaliza (acentos/espacios/mayúsculas) para que escribir el nombre de una
    // vete conocida resuelva siempre su código maestro, sin importar tildes ni espacios.
    const m = veterinarias.find((v) => `${v.codigo} — ${v.nombre}` === val)
      ?? veterinarias.find((v) => normVet(v.codigo) === valNorm)
      ?? veterinarias.find((v) => normVet(v.nombre) === valNorm);
    if (m) { setVetId(m.id); setCodigo(m.codigo); } else { setVetId(null); }
  }

  function abrirPedido(p: PedidoMobile) {
    setTab("retiro");
    setPedidoId(p.id);
    setVetId(p.veterinaria_id);
    setVetTexto(p.veterinaria_nombre);
    setCodigo(p.veterinaria_codigo);
    setUrgente(p.urgente);
    setComentarios(p.detalle ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetRetiro() {
    setVetTexto(""); setVetId(null); setCodigo("");
    setMuestras(""); setImporte("0"); setMetodoPago(""); setComentarios("");
    setUrgente(false); setPedidoId(null); setEditId(null); setFotoRetiro(null);
    if (fotoRetiroInput.current) fotoRetiroInput.current.value = "";
  }

  // Carga un retiro pendiente en el formulario para editarlo. Solo online y solo
  // mientras siga editable (pendiente en preanalítica y cobranzas).
  function editarRetiro(r: RetiroResumen) {
    if (isOffline) { toast("error", "Necesitás conexión para editar un retiro"); return; }
    if (r.editable === false) { toast("error", "Este retiro ya está en control y no se puede editar"); return; }
    setEditId(r.id);
    setPedidoId(null);
    setVetTexto(r.veterinaria);
    setVetId(r.veterinariaId ?? null);
    setCodigo(r.codigo);
    setMuestras(String(r.muestras));
    setImporte(String(r.importe));
    setMetodoPago((r.metodoPago as MetodoPago) || "");
    setComentarios(r.comentarios ?? "");
    setUrgente(!!r.urgente);
    setFotoRetiro(null);
    if (fotoRetiroInput.current) fotoRetiroInput.current.value = "";
    setTab("retiro");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ¿Ya hay un retiro de esta veterinaria cargado hoy por este cadete? Matchea
  // por id, código o nombre normalizado. Online consulta la base (ve también los
  // marcados como sospechosos); offline usa lo que ya está en el resumen del día.
  async function hayDuplicadoHoy(): Promise<boolean> {
    const nombre = normVet(vetSel?.nombre ?? vetTexto);
    const cod = normVet(codigo);
    if (!vetId && !nombre && !cod) return false;
    if (isOffline) {
      return resumenRetiros.some((r) =>
        (!!cod && normVet(r.codigo) === cod) || (!!nombre && normVet(r.veterinaria) === nombre)
      );
    }
    const { data } = await supabase
      .from("retiros")
      .select("id, veterinaria_id, veterinaria_texto_original, codigo_original")
      .eq("personal_id", personalId)
      .eq("fecha_operativa", todayISO())
      .eq("anulado", false);
    return (data ?? []).some((r) =>
      (!!vetId && r.veterinaria_id === vetId) ||
      (!!cod && normVet(r.codigo_original) === cod) ||
      (!!nombre && normVet(r.veterinaria_texto_original) === nombre)
    );
  }

  async function guardarRetiro() {
    if (!personalId) { toast("error", "No se encontró tu perfil de personal"); return; }
    if (!vetTexto.trim()) { toast("error", "Indicá la veterinaria"); return; }
    if (!muestras.trim() || parseInt(muestras) < 0) { toast("error", "Ingresá la cantidad de muestras"); return; }
    if (!importe.trim() || parseFloat(importe) < 0) { toast("error", "Ingresá el importe"); return; }
    const hayPago = parseFloat(importe) > 0;
    if (hayPago && !metodoPago) { toast("error", "Seleccioná el tipo de pago"); return; }

    // En edición no se corre el chequeo de duplicado (es el mismo retiro) ni el
    // aviso de 0 muestras: el cadete está corrigiendo un registro que ya existe.
    if (editId) { await persistRetiro(false); return; }

    // Avisos que requieren confirmación: 0 muestras (visita sin levantar nada) y
    // duplicado del día. Si hay alguno, abrimos el modal y esperamos el OK.
    const cantidad = parseInt(muestras) || 0;
    const msgs: string[] = [];
    if (cantidad === 0) {
      msgs.push("Vas a guardar un retiro con 0 muestras (pasaste por la veterinaria sin levantar ninguna).");
    }
    const dup = await hayDuplicadoHoy();
    if (dup) {
      msgs.push(`Ya cargaste un retiro de "${vetSel?.nombre ?? vetTexto}" hoy. Si confirmás, se guarda igual como una segunda visita válida.`);
    }
    if (msgs.length > 0) {
      setConfirmRetiro({ msgs, dup });
      return;
    }
    await persistRetiro(false);
  }

  // Guarda el retiro de verdad. `confirmadoDup` = el cadete aceptó un duplicado:
  // en ese caso, si el trigger de la base lo marcó como sospechoso, lo volvemos a
  // 'registrado' para que cuente como visita.
  async function persistRetiro(confirmadoDup: boolean) {
    if (!personalId) return;
    const hayPago = parseFloat(importe) > 0;

    // ── Edición de un retiro existente (solo online, solo mientras pendiente) ──
    if (editId) {
      if (isOffline) { toast("error", "Necesitás conexión para editar"); return; }
      setSavingRetiro(true);
      let nuevaFoto: string | null = null;
      if (fotoRetiro) {
        nuevaFoto = await uploadComprobante(fotoRetiro);
        if (!nuevaFoto) { setSavingRetiro(false); return; }
      }
      const res = await fetch("/api/retiros/editar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editId,
          veterinaria_id: vetId,
          veterinaria_texto_original: vetSel?.nombre ?? vetTexto,
          codigo_original: codigo || null,
          cantidad_muestras: parseInt(muestras) || 0,
          importe_declarado: parseFloat(importe) || 0,
          metodo_pago: hayPago ? (metodoPago as MetodoPago) : null,
          comentarios: comentarios.trim() || null,
          urgente,
          comprobante_url: nuevaFoto,
        }),
      });
      const json = await res.json().catch(() => ({}));
      setSavingRetiro(false);
      if (!res.ok) { toast("error", json.error ?? "No se pudo actualizar"); return; }
      toast("success", "Retiro actualizado ✓");
      resetRetiro();
      setTab("resumen");
      router.refresh();
      return;
    }

    setSavingRetiro(true);

    let comprobanteUrl: string | null = null;
    if (fotoRetiro && !isOffline) {
      comprobanteUrl = await uploadComprobante(fotoRetiro);
      if (!comprobanteUrl) { setSavingRetiro(false); return; }
    }

    const id = crypto.randomUUID();
    const retiro = {
      id,
      timestamp_carga: nowISO(),
      fecha_operativa: todayISO(),
      personal_id: personalId,
      veterinaria_id: vetId,
      veterinaria_texto_original: vetSel?.nombre ?? vetTexto,
      codigo_original: codigo || null,
      cantidad_muestras: parseInt(muestras) || 0,
      importe_declarado: parseFloat(importe) || 0,
      metodo_pago: hayPago ? (metodoPago as MetodoPago) : null,
      comprobante_url: comprobanteUrl,
      comentarios: comentarios.trim() || null,
      tipo: "veterinaria" as const,
      urgente,
      estado: "registrado" as const,
      segunda_visita: confirmadoDup,
      latitud: null,
      longitud: null,
      sincronizado: false,
      pedido_id: pedidoId,
      anulado: false,
      created_by: profileId,
    };

    if (isOffline) {
      await saveRetiroOffline({ ...retiro, _offline: true });
      await addToSyncQueue({ id: crypto.randomUUID(), action: "create", table: "retiros", data: retiro, timestamp: Date.now() });
      toast("warning", fotoRetiro
        ? "Retiro guardado offline — la foto deberá adjuntarse al reconectarse"
        : "Retiro guardado offline — se sincronizará al reconectarse");
      resetRetiro();
      setSavingRetiro(false);
      return;
    }

    // Insert directo al servidor: por definición queda sincronizado.
    const { error } = await supabase.from("retiros").insert({ ...retiro, sincronizado: true });
    if (error) { toast("error", "Error al guardar: " + error.message); setSavingRetiro(false); return; }

    // El cadete confirmó que es una segunda visita (no un duplicado). El trigger
    // ya la ignora por la bandera segunda_visita, pero por las dudas (deploy de
    // la migración pendiente) revertimos cualquier marca de sospechoso.
    if (confirmadoDup) {
      await supabase.from("retiros").update({ estado: "registrado" }).eq("id", id).eq("estado", "duplicado_sospechoso");
    }

    if (pedidoId) {
      await supabase.from("pedidos_retiro").update({ estado: "resuelto", resuelto_en: nowISO(), retiro_id: id }).eq("id", pedidoId);
    }

    toast("success", "Retiro guardado correctamente ✓");
    resetRetiro();
    setSavingRetiro(false);
    router.refresh();
  }

  async function guardarGasto() {
    if (!personalId) { toast("error", "No se encontró tu perfil de personal"); return; }
    const esDiferencia = gTipo === "diferencia_caja";
    if (!esDiferencia && !gDesc.trim()) { toast("error", "Seleccioná un concepto"); return; }
    const montoAbs = Math.abs(parseFloat(gMonto) || 0);
    // "OK" no necesita importe (es la confirmación de que coincide, sin falta ni sobra).
    if (esDiferencia && gSigno !== "ok" && montoAbs <= 0) { toast("error", "Ingresá cuánto falta o sobra"); return; }
    setSavingGasto(true);

    // Diferencia de caja: "falta" suma al gasto (empuja el efectivo esperado
    // hacia abajo, hasta igualar lo que realmente tiene en la mano); "sobra"
    // resta (lo empuja hacia arriba) — así el monto siempre se ve positivo
    // en el formulario, pero internamente queda con el signo correcto. "OK"
    // queda en $0: deja asentado que el cadete validó el efectivo contra lo
    // que figura en el sistema, sin mover el cálculo de efectivo esperado.
    const descLabel = { falta: "falta", sobra: "sobra", ok: "OK — coincide" }[gSigno];
    const gasto = {
      id: crypto.randomUUID(),
      personal_id: personalId,
      tipo: gTipo,
      descripcion: esDiferencia ? `Diferencia de caja (${descLabel})` : gDesc,
      monto: esDiferencia ? (gSigno === "ok" ? 0 : gSigno === "sobra" ? -montoAbs : montoAbs) : (parseFloat(gMonto) || 0),
      fecha_operativa: gFecha,
      comprobante_url: null as string | null,
      estado: "pendiente" as const,
    };

    // Offline: encolar para sincronizar al reconectarse (la foto se adjunta luego).
    if (isOffline) {
      await addToSyncQueue({ id: crypto.randomUUID(), action: "create", table: "gastos", data: gasto, timestamp: Date.now() });
      toast("warning", fotoGasto
        ? "Gasto guardado offline — la foto deberá adjuntarse al reconectarse"
        : "Gasto guardado offline — se sincronizará al reconectarse");
      setGDesc(""); setGMonto(""); setFotoGasto(null);
      if (fotoGastoInput.current) fotoGastoInput.current.value = "";
      setSavingGasto(false);
      return;
    }

    if (fotoGasto) {
      const url = await uploadComprobante(fotoGasto);
      if (!url) { setSavingGasto(false); return; }
      gasto.comprobante_url = url;
    }

    const { error } = await supabase.from("gastos").insert(gasto);
    if (error) { toast("error", "Error al guardar: " + error.message); setSavingGasto(false); return; }
    toast("success", "Gasto registrado correctamente ✓");
    setGDesc(""); setGMonto(""); setFotoGasto(null);
    if (fotoGastoInput.current) fotoGastoInput.current.value = "";
    setSavingGasto(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const vetSel = vetId ? veterinarias.find((v) => v.id === vetId) ?? null : null;

  const inputCls = "w-full px-3.5 py-3 border-2 border-gy200 rounded-[10px] text-[14px] bg-gy50 focus:outline-none focus:border-g500 focus:bg-white transition-colors";
  const bigCls = "text-center text-[22px] font-bold";

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header verde */}
      <header className="bg-g800 text-white px-4 pt-4 pb-3.5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-g500 flex items-center justify-center text-[12px] font-bold border-2 border-white/20 shrink-0">
          {initials(nombre)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold truncate">{nombre}</div>
          <div className="text-[11px] text-white/60 truncate">{zonaNombre} · Personal de logística</div>
        </div>
        <button onClick={handleLogout} aria-label="Cerrar sesión"
          className="ml-auto flex items-center gap-1.5 text-white/80 hover:text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
          Salir
        </button>
      </header>

      <div className="flex-1 px-4 py-4 space-y-3.5">
        {/* Sync status */}
        <div className={`flex items-center gap-2 text-[12px] font-medium px-3.5 py-2.5 rounded-[10px] ${isOffline ? "bg-amber/15 text-amber-text" : pendingCount > 0 ? "bg-blue-50 text-blue-700" : "bg-g50 text-g700"}`}>
          <span className={`w-2 h-2 rounded-full ${isOffline ? "bg-amber" : isSyncing ? "bg-blue-400 animate-pulse" : pendingCount > 0 ? "bg-blue-400" : "bg-g500"}`} />
          <span className="flex-1">
            {isOffline
              ? `Sin conexión · ${pendingCount} pendiente${pendingCount !== 1 ? "s" : ""} en el dispositivo`
              : isSyncing
                ? "Sincronizando…"
                : pendingCount > 0
                  ? `${pendingCount} sin sincronizar`
                  : "Conectado · sincronización automática"}
          </span>
          {!isOffline && !isSyncing && pendingCount > 0 && (
            <button onClick={() => sync()} className="text-[11px] font-semibold underline shrink-0">Reintentar</button>
          )}
        </div>

        {/* Banner pedidos */}
        {bannerOpen && pedidos.length > 0 && (
          <button onClick={() => setTab("pedidos")}
            className="w-full flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-[12px] px-3.5 py-3 text-left">
            <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0">
              <i className="ti ti-map-pin text-[16px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-blue-800">{pedidos.length} pedido{pedidos.length !== 1 ? "s" : ""} de retiro asignado{pedidos.length !== 1 ? "s" : ""}</div>
              <div className="text-[11px] text-blue-600 truncate">{pedidos.map((p) => p.veterinaria_nombre).join(" · ")}</div>
            </div>
            <span className="ml-auto w-6 h-6 rounded-full bg-blue-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0">{pedidos.length}</span>
          </button>
        )}

        {/* Tabs */}
        <div className="flex bg-gy100 rounded-[10px] p-1">
          {([["resumen", "Resumen"], ["retiro", "Nuevo retiro"], ["pedidos", "Pedidos"], ["gastos", "Gastos"]] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-[8px] text-[11px] font-semibold transition-all ${tab === t ? "bg-white text-g700 shadow-sm" : "text-gy500"}`}>
              {label}
              {t === "pedidos" && pedidos.length > 0 && (
                <span className="ml-1 text-[9px] bg-blue-500 text-white rounded-full px-1.5 py-0.5">{pedidos.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* TAB: Resumen del día */}
        {tab === "resumen" && (
          <div className="space-y-3">
            <div className="text-[11px] text-gy400">Tu actividad de hoy · {todayISO().split("-").reverse().join("/")}</div>
            <div className="grid grid-cols-3 gap-2">
              {/* Veterinarias (clickable) */}
              <button onClick={() => setVerVets((v) => !v)}
                className={`flex flex-col items-center justify-center gap-0.5 py-3.5 rounded-[12px] border-2 transition-all ${verVets ? "border-g500 bg-g50" : "border-gy200 bg-white"}`}>
                <span className="text-[24px] font-bold text-g700 leading-none">{totalVisitas}</span>
                <span className="text-[10px] font-semibold text-gy500 flex items-center gap-0.5">
                  Visitas <i className={`ti ti-chevron-${verVets ? "up" : "down"} text-[11px]`} />
                </span>
              </button>
              {/* Ingreso total */}
              <div className="flex flex-col items-center justify-center gap-0.5 py-3.5 rounded-[12px] border-2 border-gy200 bg-white">
                <span className="text-[18px] font-bold text-g700 leading-none">{fmtMoneySign(totalImporte)}</span>
                <span className="text-[10px] font-semibold text-gy500">Ingreso día</span>
              </div>
              {/* Muestras */}
              <div className="flex flex-col items-center justify-center gap-0.5 py-3.5 rounded-[12px] border-2 border-gy200 bg-white">
                <span className="text-[24px] font-bold text-g700 leading-none">{totalMuestras}</span>
                <span className="text-[10px] font-semibold text-gy500">Muestras</span>
              </div>
            </div>

            {/* Gastos + efectivo esperado: así no hay que hacer la resta a
                mano para saber cuánto debería haber en la mano. Tocando el
                importe esperado se va directo a cargar la diferencia de caja. */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col items-center justify-center gap-0.5 py-3 rounded-[12px] border-2 border-gy200 bg-white">
                <span className="text-[16px] font-bold text-gy700 leading-none">{fmtMoneySign(totalGastosHoy)}</span>
                <span className="text-[10px] font-semibold text-gy500">Gastos hoy</span>
              </div>
              <button onClick={() => { setTab("gastos"); setGTipo("diferencia_caja"); }}
                className="flex flex-col items-center justify-center gap-0.5 py-3 rounded-[12px] border-2 border-g300 bg-g50 active:bg-g100 transition-colors">
                <span className="text-[16px] font-bold text-g800 leading-none">{fmtMoneySign(efectivoEsperadoHoy)}</span>
                <span className="text-[10px] font-semibold text-g700 flex items-center gap-0.5">
                  Efectivo esperado <i className="ti ti-pencil text-[10px]" />
                </span>
              </button>
            </div>

            {/* Listado de veterinarias visitadas (al tocar el número) */}
            {verVets && (
              <div className="bg-white border border-gy200 rounded-[12px] overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-gy100 text-[11px] font-bold uppercase tracking-wide text-gy400">
                  Veterinarias visitadas hoy
                </div>
                {resumenRetiros.length === 0 ? (
                  <div className="py-8 text-center text-[12px] text-gy400">Todavía no cargaste retiros hoy</div>
                ) : (
                  <div className="divide-y divide-gy100">
                    {resumenRetiros.map((r) => {
                      // Solo los retiros del servidor traen `editable`; los
                      // offline (sin sincronizar) no se editan hasta subir.
                      const puedeEditar = r.editable === true && !isOffline;
                      return (
                      <div key={r.id} className="flex items-center gap-3 px-3.5 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[15px] font-bold text-gy900 leading-tight">{r.codigo || "S/C"}</div>
                          <div className="text-[11px] text-gy500 truncate">{r.veterinaria}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[13px] font-semibold text-g700">{fmtMoneySign(r.importe)}</div>
                          <div className="text-[10px] text-gy400">{r.muestras} muestra{r.muestras !== 1 ? "s" : ""}</div>
                        </div>
                        {puedeEditar ? (
                          <button onClick={() => editarRetiro(r)} title="Editar retiro"
                            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-[8px] border border-g300 text-g700 hover:bg-g50">
                            <i className="ti ti-pencil text-[16px]" />
                          </button>
                        ) : (
                          <span title="Ya está en control — no se puede editar"
                            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-[8px] text-gy300">
                            <i className="ti ti-lock text-[15px]" />
                          </span>
                        )}
                      </div>
                    );})}
                  </div>
                )}
              </div>
            )}

            <button onClick={() => setTab("retiro")}
              className="w-full py-3 bg-g800 hover:bg-g700 text-white font-bold rounded-[12px] text-[14px] flex items-center justify-center gap-2 transition-colors">
              <i className="ti ti-circle-plus text-[18px]" /> Cargar nuevo retiro
            </button>
          </div>
        )}

        {/* TAB: Nuevo retiro */}
        {tab === "retiro" && (
          <div className="space-y-3">
            {editId && (
              <div className="flex items-center gap-2 bg-amber-bg border border-amber/40 rounded-[10px] px-3 py-2 text-[11px] text-amber-text">
                <i className="ti ti-pencil text-[14px]" />
                Editando un retiro ya cargado
                <button onClick={() => { resetRetiro(); setTab("resumen"); }} className="ml-auto text-amber-text/70 hover:text-amber-text"><i className="ti ti-x" /></button>
              </div>
            )}
            {pedidoId && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-[10px] px-3 py-2 text-[11px] text-blue-700">
                <i className="ti ti-link text-[14px]" />
                Registrando retiro de un pedido asignado
                <button onClick={resetRetiro} className="ml-auto text-blue-500 hover:text-blue-700"><i className="ti ti-x" /></button>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-semibold text-gy600 mb-1.5">Veterinaria <span className="text-red-500">*</span></label>
              <input list="mob-vets" required className={inputCls} placeholder="Buscar por nombre o código..."
                value={vetTexto} onChange={(e) => matchVet(e.target.value)} />
              <datalist id="mob-vets">
                {veterinarias.map((v) => <option key={v.id} value={`${v.codigo} — ${v.nombre}`} />)}
              </datalist>
              {vetSel && (
                <div className="mt-2 flex flex-col gap-1.5 bg-g50 border border-g200 rounded-[10px] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <i className="ti ti-building-store text-[17px] text-g600 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[18px] font-bold text-gy900 leading-tight">{vetSel.codigo || "S/C"}</div>
                      <div className="text-[12px] text-gy500 truncate">{vetSel.nombre}</div>
                    </div>
                  </div>
                  {vetSel.telefono && (
                    <a href={`tel:${vetSel.telefono.replace(/\s+/g, "")}`}
                      className="flex items-center gap-2 text-[13px] font-semibold text-g700">
                      <i className="ti ti-phone text-[15px]" />
                      <span className="flex-1">{vetSel.telefono}</span>
                      <span className="text-[10px] font-medium text-g600 bg-white border border-g300 rounded-full px-2 py-0.5">Llamar</span>
                    </a>
                  )}
                  {vetSel.direccion && (
                    <div className="flex items-start gap-2 text-[12px] text-gy600">
                      <i className="ti ti-map-pin text-[14px] mt-0.5 shrink-0" />
                      <span>{vetSel.direccion}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gy600 mb-1.5">Muestras <span className="text-red-500">*</span></label>
              <input type="number" inputMode="numeric" min="0" required className={`${inputCls} ${bigCls}`} placeholder="0"
                onFocus={(e) => e.target.select()}
                value={muestras} onChange={(e) => setMuestras(e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gy600 mb-1.5">Importe cobrado <span className="text-red-500">*</span></label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[22px] font-bold text-g700 pointer-events-none">$</span>
                <input type="number" inputMode="decimal" min="0" required
                  className={`${inputCls} ${bigCls} pl-9 border-g500 bg-white`} placeholder="0"
                  onFocus={(e) => e.target.select()}
                  value={importe} onChange={(e) => setImporte(e.target.value)} />
              </div>
              <div className="text-[10px] text-gy400 mt-1">Si no cobraste, dejá en <span className="font-semibold">0</span>.</div>
            </div>
            {parseFloat(importe) > 0 && (
              <div>
                <label className="block text-[11px] font-semibold text-gy600 mb-1.5">Tipo de pago <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-3 gap-2">
                  {([["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["mercado_pago", "Mercado Pago"]] as [MetodoPago, string][]).map(([val, label]) => (
                    <button key={val} type="button" onClick={() => setMetodoPago(val)}
                      className={`py-2.5 px-1 rounded-[10px] border-2 text-[12px] font-medium transition-all ${metodoPago === val ? "bg-g800 text-white border-g800" : "bg-white text-gy600 border-gy200"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-semibold text-gy600 mb-1.5">Comentarios</label>
              <input className={inputCls} placeholder="Opcional..." value={comentarios} onChange={(e) => setComentarios(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input ref={fotoRetiroInput} type="file" accept="image/*" className="hidden"
                onChange={(e) => setFotoRetiro(e.target.files?.[0] ?? null)} />
              <button type="button" onClick={() => fotoRetiroInput.current?.click()}
                className={`flex flex-col items-center justify-center gap-1 py-3 rounded-[10px] border-2 text-[12px] font-medium transition-all ${fotoRetiro ? "border-g500 bg-g50 text-g700" : "border-dashed border-gy300 text-gy500"}`}>
                <i className="ti ti-camera text-[18px]" />
                {fotoRetiro ? "Foto cargada ✓" : "Foto comprobante"}
              </button>
              <button type="button" onClick={() => setUrgente((v) => !v)}
                className={`flex flex-col items-center justify-center gap-1 py-3 rounded-[10px] border-2 text-[12px] font-medium transition-all ${urgente ? "border-red-400 bg-red-50 text-red-600" : "border-dashed border-gy300 text-gy500"}`}>
                <i className="ti ti-alert-triangle text-[18px]" />
                {urgente ? "URGENTE" : "Marcar urgente"}
              </button>
            </div>
            {fotoRetiro && (
              <div className="flex items-center gap-2 text-[11px] text-g700 bg-g50 rounded-[8px] px-3 py-2">
                <i className="ti ti-photo" />
                <span className="truncate flex-1">{fotoRetiro.name}</span>
                <button type="button" onClick={() => { setFotoRetiro(null); if (fotoRetiroInput.current) fotoRetiroInput.current.value = ""; }}
                  className="text-gy400 hover:text-red-500"><i className="ti ti-x" /></button>
              </div>
            )}
            <button onClick={guardarRetiro} disabled={savingRetiro}
              className="w-full py-3.5 bg-g800 hover:bg-g700 text-white font-bold rounded-[12px] text-[15px] flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
              {savingRetiro ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <i className="ti ti-device-floppy text-[18px]" />}
              {editId ? "GUARDAR CAMBIOS" : "GUARDAR RETIRO"}
            </button>
            <div className="text-center text-[11px] text-gy400">
              {editId ? "Estás editando un retiro pendiente" : "Se guarda localmente si no hay conexión"}
            </div>
          </div>
        )}

        {/* TAB: Pedidos */}
        {tab === "pedidos" && (
          <div className="space-y-3">
            <div className="text-[11px] text-gy400">Tocá un pedido para abrir el formulario de retiro ya cargado</div>
            {pedidos.length === 0 && (
              <div className="py-12 text-center text-gy400 text-[13px]">No tenés pedidos asignados</div>
            )}
            {pedidos.map((p) => {
              return (
                <div key={p.id} className="bg-white border border-blue-200 border-l-4 border-l-blue-500 rounded-[12px] px-3.5 py-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[18px] font-bold text-gy900 leading-tight">{p.veterinaria_codigo || "S/C"}</div>
                      <div className="text-[12px] text-gy500 truncate">{p.veterinaria_nombre}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {p.materiales && p.materiales.length > 0 && (
                        <span className="flex items-center gap-1 text-[9px] font-bold bg-g700 text-white rounded-full px-2 py-0.5">
                          <i className="ti ti-package text-[11px]" /> DEJAR MATERIAL
                        </span>
                      )}
                      {p.urgente && <span className="text-[9px] font-bold bg-red-500 text-white rounded-full px-2 py-0.5">URGENTE</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-blue-700 mt-1.5">
                    <i className="ti ti-clock-hour-4 text-[14px]" />
                    Horario de retiro: {formatDateTime(p.fecha_limite)}
                  </div>
                  {p.detalle && <div className="text-[11px] text-gy500 mt-0.5">{p.detalle}</div>}
                  {p.materiales && p.materiales.length > 0 && (
                    <div className="mt-2 rounded-[8px] border border-g200 bg-g50 px-2.5 py-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-g700 mb-1">
                        <i className="ti ti-package text-[14px]" /> Materiales para dejar en la vete
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {p.materiales.map((m) => (
                          <span key={m} className="text-[11px] bg-white border border-g300 text-g700 rounded-full px-2 py-0.5">{m}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <button onClick={() => abrirPedido(p)}
                    className="w-full mt-2.5 flex items-center justify-center gap-1.5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-[13px] font-semibold rounded-[10px] transition-colors">
                    <i className="ti ti-circle-plus text-[16px]" /> Registrar este retiro
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB: Gastos */}
        {tab === "gastos" && (
          <div className="space-y-3">
            <div className="text-[11px] text-gy400">Registrá un gasto o retiro de dinero para recupero</div>
            <div>
              <label className="block text-[11px] font-semibold text-gy600 mb-1.5">Tipo</label>
              <div className="flex gap-2">
                {([["gasto", "Gasto"], ["retiro_dinero", "Retiro $"], ["diferencia_caja", "Diferencia caja"]] as ["gasto" | "retiro_dinero" | "diferencia_caja", string][]).map(([val, label]) => (
                  <button key={val} type="button" onClick={() => { setGTipo(val); setGDesc(""); }}
                    className={`flex-1 py-2.5 rounded-[10px] border-2 text-[12px] font-medium transition-all ${gTipo === val ? "bg-purple-600 text-white border-purple-600" : "bg-white text-gy600 border-gy200"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {gTipo === "diferencia_caja" ? (
              <div>
                <label className="block text-[11px] font-semibold text-gy600 mb-1.5">Contaste tu efectivo y...</label>
                <div className="flex gap-2">
                  {([["falta", "Me falta"], ["sobra", "Me sobra"], ["ok", "OK, coincide"]] as ["falta" | "sobra" | "ok", string][]).map(([val, label]) => (
                    <button key={val} type="button" onClick={() => setGSigno(val)}
                      className={`flex-1 py-2.5 rounded-[10px] border-2 text-[12px] font-medium transition-all ${gSigno === val ? (val === "falta" ? "bg-red-600 border-red-600 text-white" : val === "sobra" ? "bg-g700 border-g700 text-white" : "bg-blue-600 border-blue-600 text-white") : "bg-white text-gy600 border-gy200"}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-gy400 mt-1.5">
                  {gSigno === "ok"
                    ? "Vas a dejar asentado que tu efectivo coincide con lo que figura en DiagnoLis."
                    : "Ingresá el importe de la diferencia, siempre en positivo — acá elegís si falta o sobra."}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-[11px] font-semibold text-gy600 mb-1.5">Concepto <span className="text-red-500">*</span></label>
                <select className={inputCls} value={gDesc} onChange={(e) => setGDesc(e.target.value)}>
                  <option value="">Seleccioná un concepto…</option>
                  {(gTipo === "retiro_dinero"
                    ? ["Zona extra", "Reemplazo", "Honorarios"]
                    : ["Peaje", "Nafta", "Estacionamiento", "Bebida"]
                  ).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}
            <div className={gTipo === "diferencia_caja" && gSigno === "ok" ? "grid grid-cols-1" : "grid grid-cols-2 gap-3"}>
              {!(gTipo === "diferencia_caja" && gSigno === "ok") && (
                <div>
                  <label className="block text-[11px] font-semibold text-gy600 mb-1.5">
                    {gTipo === "diferencia_caja" ? "Diferencia $" : "Monto $"}
                  </label>
                  <input type="number" inputMode="decimal" min="0" className={`${inputCls} ${bigCls}`} placeholder="0"
                    value={gMonto} onChange={(e) => setGMonto(e.target.value)} />
                </div>
              )}
              <div>
                <label className="block text-[11px] font-semibold text-gy600 mb-1.5">Fecha</label>
                <input type="date" className={inputCls} value={gFecha} onChange={(e) => setGFecha(e.target.value)} />
              </div>
            </div>
            <input ref={fotoGastoInput} type="file" accept="image/*" className="hidden"
              onChange={(e) => setFotoGasto(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => fotoGastoInput.current?.click()}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-[10px] border-2 text-[13px] font-medium transition-all ${fotoGasto ? "border-purple-400 bg-purple-50 text-purple-700" : "border-dashed border-gy300 text-gy500"}`}>
              <i className="ti ti-camera text-[16px]" />
              {fotoGasto ? "Foto del ticket cargada ✓" : "Foto del ticket"}
            </button>
            {fotoGasto && (
              <div className="flex items-center gap-2 text-[11px] text-purple-700 bg-purple-50 rounded-[8px] px-3 py-2">
                <i className="ti ti-photo" />
                <span className="truncate flex-1">{fotoGasto.name}</span>
                <button type="button" onClick={() => { setFotoGasto(null); if (fotoGastoInput.current) fotoGastoInput.current.value = ""; }}
                  className="text-gy400 hover:text-red-500"><i className="ti ti-x" /></button>
              </div>
            )}
            <button onClick={guardarGasto} disabled={savingGasto}
              className="w-full py-3.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-[12px] text-[15px] flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
              {savingGasto ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <i className="ti ti-device-floppy text-[18px]" />}
              {gTipo === "diferencia_caja" ? (gSigno === "ok" ? "CONFIRMAR OK" : "GUARDAR DIFERENCIA") : "GUARDAR GASTO"}
            </button>
          </div>
        )}
      </div>

      {confirmRetiro && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={() => setConfirmRetiro(null)}>
          <div className="bg-white rounded-[16px] shadow-xl max-w-[420px] w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gy100 flex items-center gap-2.5">
              <i className="ti ti-alert-triangle text-[22px] text-amber-500" />
              <span className="text-[15px] font-semibold text-gy900">Confirmá antes de guardar</span>
            </div>
            <div className="px-5 py-4 space-y-3">
              {confirmRetiro.msgs.map((m, i) => (
                <div key={i} className="flex items-start gap-2 text-[13px] text-gy700 leading-snug">
                  <i className="ti ti-point-filled text-[15px] text-amber-500 mt-0.5 shrink-0" />
                  <span>{m}</span>
                </div>
              ))}
              <p className="text-[12px] text-gy500 pt-0.5">¿Querés guardar de todas formas?</p>
            </div>
            <div className="px-5 py-3.5 bg-gy50 border-t border-gy100 flex gap-2.5">
              <button type="button" onClick={() => setConfirmRetiro(null)}
                className="flex-1 py-3 text-[14px] font-semibold bg-white text-gy600 border-2 border-gy200 rounded-[12px]">
                Cancelar
              </button>
              <button type="button" disabled={savingRetiro}
                onClick={() => { const dup = confirmRetiro.dup; setConfirmRetiro(null); persistRetiro(dup); }}
                className="flex-1 py-3 text-[14px] font-bold bg-g700 text-white rounded-[12px] disabled:opacity-60">
                Sí, guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
