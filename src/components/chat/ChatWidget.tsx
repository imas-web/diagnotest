"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cn, initials } from "@/lib/utils/format";
import { formatTime } from "@/lib/utils/dates";
import { toast } from "@/components/ui/ToastNotification";
import {
  type Perfil, type Conversacion, type Mensaje, type UltimoMensaje, type Grupo,
  nombreConversacion, iconoConversacion, tieneNoLeidos, remitenteDe, SELECT_CONVERSACIONES, SELECT_MENSAJE,
} from "@/components/chat/chatShared";

// Acceso rápido al chat interno sin salir de la pantalla en la que se está
// (ej. mientras se está en Configuración). El chat completo (más canales,
// búsqueda, etc.) sigue en /chat — este widget es un atajo, no un
// reemplazo, así que se oculta ahí para no duplicar la misma UI.
export function ChatWidget({ me }: { me: Perfil }) {
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);

  const [open, setOpen] = useState(false);
  const [cargado, setCargado] = useState(false);
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [contactos, setContactos] = useState<Perfil[]>([]);
  const [ultimos, setUltimos] = useState<UltimoMensaje[]>([]);
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargandoMensajes, setCargandoMensajes] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mostrarNuevo, setMostrarNuevo] = useState(false);
  const [buscarContacto, setBuscarContacto] = useState("");
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  // Grupos abiertos para mandar un mensaje sin ser miembro (lista de
  // difusión): no se va a ver su historial ni las respuestas.
  const [gruposAjenos, setGruposAjenos] = useState<Set<string>>(new Set());

  const mensajesEndRef = useRef<HTMLDivElement>(null);

  async function cargarTodo() {
    // Los contactos se piden a /api/chat/contactos (service role) porque la
    // política de SELECT de profiles no deja leer perfiles ajenos a
    // cualquier rol — con el cliente de sesión, algunos roles se quedaban
    // sin resultados (veían Grupos, que sí se resuelve así, pero nunca
    // Personas).
    const [{ data: convs, error: errConvs }, contactosRes] = await Promise.all([
      supabase.from("chat_conversaciones").select(SELECT_CONVERSACIONES).order("created_at", { ascending: true }),
      fetch("/api/chat/contactos").then((r) => r.json()).catch(() => ({ error: "No se pudo conectar" })),
    ]);
    if (errConvs) toast("error", "No se pudieron cargar las conversaciones: " + errConvs.message);
    if (contactosRes.error) toast("error", "No se pudieron cargar los contactos: " + contactosRes.error);
    setConversaciones((convs ?? []) as unknown as Conversacion[]);
    setContactos(contactosRes.contactos ?? []);
    const ids = (convs ?? []).map((c) => c.id);
    if (ids.length) {
      const { data: ult } = await supabase
        .from("chat_mensajes")
        .select("conversacion_id, contenido, adjunto_tipo, remitente_id, created_at")
        .in("conversacion_id", ids)
        .order("created_at", { ascending: false })
        .limit(200);
      setUltimos(ult ?? []);
    }
    setCargado(true);
  }

  // Se carga de entrada (no solo al abrir) para poder mostrar la cantidad
  // de mensajes sin leer en el botón cerrado, sin tener que abrir el chat.
  useEffect(() => {
    cargarTodo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Se refresca la lista si alguien me suma a una conversación nueva,
  // esté abierto el widget o no (mismo mecanismo que la pantalla completa).
  useEffect(() => {
    const canal = supabase
      .channel(`chat-widget-miembros-${me.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_miembros", filter: `profile_id=eq.${me.id}` },
        () => { if (cargado) cargarTodo(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(canal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id, supabase, cargado]);

  function marcarLeido(conversacionId: string) {
    const ahora = new Date().toISOString();
    setConversaciones((prev) => prev.map((c) => c.id !== conversacionId ? c : {
      ...c,
      chat_miembros: c.chat_miembros.map((m) => m.profile_id === me.id ? { ...m, last_read_at: ahora } : m),
    }));
    supabase.from("chat_miembros").update({ last_read_at: ahora })
      .eq("conversacion_id", conversacionId).eq("profile_id", me.id).then();
  }

  useEffect(() => {
    if (!seleccionada) { setMensajes([]); return; }
    let activo = true;
    setCargandoMensajes(true);
    supabase
      .from("chat_mensajes")
      .select(SELECT_MENSAJE)
      .eq("conversacion_id", seleccionada)
      .order("created_at", { ascending: true })
      .limit(200)
      .then(({ data, error }) => {
        if (!activo) return;
        if (error) toast("error", "No se pudieron cargar los mensajes");
        setMensajes((data ?? []) as Mensaje[]);
        setCargandoMensajes(false);
      });
    marcarLeido(seleccionada);

    const canal = supabase
      .channel(`chat-widget-${seleccionada}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_mensajes", filter: `conversacion_id=eq.${seleccionada}` },
        (payload) => {
          // El evento realtime no trae el remitente embebido (eso es cosa
          // de PostgREST, no de Realtime) — se completa a mano.
          const cruda = payload.new as Mensaje;
          const nuevo: Mensaje = {
            ...cruda,
            remitente: cruda.remitente_id === me.id ? me : contactos.find((c) => c.id === cruda.remitente_id) ?? null,
          };
          setMensajes((prev) => (prev.some((m) => m.id === nuevo.id) ? prev : [...prev, nuevo]));
          marcarLeido(seleccionada);
        }
      )
      .subscribe();

    return () => { activo = false; supabase.removeChannel(canal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionada, supabase]);

  useEffect(() => {
    mensajesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes]);

  const previewPorConversacion = useMemo(() => {
    const m = new Map<string, UltimoMensaje>();
    for (const u of ultimos) if (!m.has(u.conversacion_id)) m.set(u.conversacion_id, u);
    return m;
  }, [ultimos]);

  const listaOrdenada = useMemo(() => {
    return [...conversaciones].sort((a, b) => {
      if (a.tipo === "general") return -1;
      if (b.tipo === "general") return 1;
      if (a.tipo !== b.tipo) return a.tipo === "grupo" ? -1 : 1;
      const ta = previewPorConversacion.get(a.id)?.created_at ?? a.created_at;
      const tb = previewPorConversacion.get(b.id)?.created_at ?? b.created_at;
      return tb.localeCompare(ta);
    });
  }, [conversaciones, previewPorConversacion]);

  const noLeidosCount = useMemo(
    () => conversaciones.filter((c) => tieneNoLeidos(c, me.id, previewPorConversacion.get(c.id))).length,
    [conversaciones, previewPorConversacion, me.id]
  );

  const conversacionActual = conversaciones.find((c) => c.id === seleccionada) ?? null;
  const puedeEscribir =
    conversacionActual?.tipo !== "general" || me.rol === "dueno" || me.rol === "super_admin";

  useEffect(() => {
    if (!mostrarNuevo || grupos.length) return;
    fetch("/api/chat/grupos").then((r) => r.json()).then((json) => setGrupos(json.grupos ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarNuevo]);

  function abrirGrupo(grupo: Grupo) {
    const existente = conversaciones.find((c) => c.id === grupo.id);
    if (!existente) {
      const nuevaConv: Conversacion = {
        id: grupo.id, tipo: "grupo", nombre: grupo.nombre, dm_clave: null, created_at: new Date().toISOString(),
        chat_miembros: [],
      };
      setConversaciones((prev) => [...prev, nuevaConv]);
      setGruposAjenos((prev) => new Set(prev).add(grupo.id));
    }
    setSeleccionada(grupo.id);
    setMostrarNuevo(false);
    setBuscarContacto("");
  }

  async function eliminarConversacion(c: Conversacion, e: React.MouseEvent) {
    e.stopPropagation();
    const nombre = nombreConversacion(c, me.id);
    if (!confirm(`¿Eliminar definitivamente la conversación con "${nombre}"?\n\nSe borra el historial para todos los que participaban. Esta acción no se puede deshacer.`)) return;
    const res = await fetch("/api/chat/conversaciones/eliminar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { toast("error", json.error ?? "No se pudo eliminar"); return; }
    setConversaciones((prev) => prev.filter((x) => x.id !== c.id));
    if (seleccionada === c.id) setSeleccionada(null);
    toast("success", "Conversación eliminada");
  }

  async function abrirDM(otroId: string) {
    const clave = [me.id, otroId].sort().join("|");
    const existente = conversaciones.find((c) => c.dm_clave === clave);
    if (existente) { setSeleccionada(existente.id); setMostrarNuevo(false); return; }

    const res = await fetch("/api/chat/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otroId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.conversacionId) { toast("error", json.error ?? "No se pudo iniciar la conversación"); return; }

    const otro = contactos.find((c) => c.id === otroId) ?? null;
    const nuevaConv: Conversacion = {
      id: json.conversacionId, tipo: "dm", nombre: null, dm_clave: clave, created_at: new Date().toISOString(),
      chat_miembros: [{ profile_id: me.id, profiles: me }, { profile_id: otroId, profiles: otro }],
    };
    setConversaciones((prev) => [...prev, nuevaConv]);
    setSeleccionada(json.conversacionId);
    setMostrarNuevo(false);
    setBuscarContacto("");
  }

  async function enviarMensaje() {
    const contenido = texto.trim();
    if (!contenido || !seleccionada || enviando) return;
    setEnviando(true);
    const id = crypto.randomUUID();
    const nuevo: Mensaje = {
      id, conversacion_id: seleccionada, remitente_id: me.id, contenido,
      adjunto_url: null, adjunto_tipo: null, adjunto_nombre: null, created_at: new Date().toISOString(), remitente: me,
    };
    const { error } = await supabase
      .from("chat_mensajes")
      .insert({ id, conversacion_id: seleccionada, remitente_id: me.id, contenido });
    setEnviando(false);
    if (error) { toast("error", error.message || "No se pudo enviar el mensaje"); return; }
    setTexto("");
    setMensajes((prev) => (prev.some((m) => m.id === nuevo.id) ? prev : [...prev, nuevo]));
  }

  const contactosFiltrados = contactos.filter((c) => {
    const q = buscarContacto.trim().toLowerCase();
    if (!q) return true;
    return c.nombre.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

  const gruposFiltrados = grupos.filter((g) => {
    const q = buscarContacto.trim().toLowerCase();
    if (!q) return true;
    return (g.nombre ?? "").toLowerCase().includes(q);
  });

  if (pathname === "/chat") return null;

  return (
    <>
      {/* Mismo patrón que el botón de DiagnoLis: pill con el nombre arriba,
          para que a simple vista se distinga del asistente automático. */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-center gap-1.5">
        {!open && (
          <span className="px-2 py-1 rounded-full bg-g700 text-white text-[10px] font-semibold shadow-lg pointer-events-none whitespace-nowrap">
            Chat interno
          </span>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Cerrar chat" : "Abrir chat interno"}
          title="Chat interno de Diagnotest (no es DiagnoLis)"
          className="relative w-14 h-14 rounded-full bg-g700 text-white shadow-lg flex items-center justify-center hover:bg-g800 transition-colors text-[24px] leading-none"
        >
          {open ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          ) : (
            <span aria-hidden>👥</span>
          )}
          {!open && noLeidosCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[19px] h-[19px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
              {noLeidosCount > 9 ? "9+" : noLeidosCount}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div className="fixed bottom-24 right-5 z-50 w-[min(340px,calc(100vw-2.5rem))] h-[min(480px,calc(100vh-8rem))] bg-white rounded-xl shadow-2xl border border-gy200 flex flex-col overflow-hidden">
          <div className="bg-g700 text-white px-3 py-2.5 shrink-0 flex items-center gap-2">
            {seleccionada ? (
              <button onClick={() => setSeleccionada(null)} className="text-white/90 hover:text-white shrink-0" aria-label="Volver">
                <i className="ti ti-arrow-left text-[16px]" />
              </button>
            ) : (
              <span className="text-[15px] shrink-0" aria-hidden>👥</span>
            )}
            <span className="font-semibold text-[13px] flex-1 truncate">
              {seleccionada && conversacionActual ? nombreConversacion(conversacionActual, me.id) : "Chat interno"}
            </span>
            <Link href="/chat" className="text-white/80 hover:text-white shrink-0" title="Abrir pantalla completa">
              <i className="ti ti-arrows-diagonal text-[15px]" />
            </Link>
          </div>

          {!cargado ? (
            <div className="flex-1 flex items-center justify-center text-[12px] text-gy400">Cargando…</div>
          ) : !seleccionada ? (
            <>
              <div className="p-2 border-b border-gy100 shrink-0">
                <button
                  onClick={() => setMostrarNuevo(true)}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11.5px] font-medium bg-g50 text-g700 rounded-[8px] hover:bg-g100"
                >
                  <i className="ti ti-edit text-[13px]" /> Nuevo mensaje
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {listaOrdenada.map((c) => {
                  const preview = previewPorConversacion.get(c.id);
                  const nombre = nombreConversacion(c, me.id);
                  const noLeida = tieneNoLeidos(c, me.id, preview);
                  return (
                    <div
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSeleccionada(c.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") setSeleccionada(c.id); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left border-b border-gy50 hover:bg-gy50 cursor-pointer"
                    >
                      <div className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold",
                        c.tipo === "dm" ? "bg-gy100 text-gy600" : "bg-g100 text-g700"
                      )}>
                        {c.tipo === "dm" ? initials(nombre) : <i className={cn("ti", iconoConversacion(c), "text-[13px]")} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={cn("text-[12px] truncate", noLeida ? "font-bold text-gy900" : "font-semibold text-gy900")}>{nombre}</div>
                        <div className={cn("text-[10.5px] truncate", noLeida ? "text-gy700 font-medium" : "text-gy400")}>
                          {preview
                            ? preview.adjunto_tipo
                              ? (preview.remitente_id === me.id ? "Vos: " : "") + (preview.adjunto_tipo === "imagen" ? "📷 Foto" : "📎 Archivo")
                              : (preview.remitente_id === me.id ? "Vos: " : "") + (preview.contenido ?? "")
                            : "Sin mensajes todavía"}
                        </div>
                      </div>
                      {noLeida && <span className="w-2 h-2 rounded-full bg-g600 shrink-0" />}
                      {me.rol === "super_admin" && c.tipo !== "general" && (
                        <button
                          onClick={(e) => eliminarConversacion(c, e)}
                          title="Eliminar conversación"
                          className="shrink-0 w-5 h-5 flex items-center justify-center rounded-[5px] text-gy300 hover:text-red-600 hover:bg-red-50"
                        >
                          <i className="ti ti-trash text-[11px]" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {!listaOrdenada.length && (
                  <div className="p-5 text-center text-[11.5px] text-gy400">Sin conversaciones todavía</div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-2.5 py-2.5 space-y-2 bg-gy50">
                {cargandoMensajes ? (
                  <div className="text-center text-[11.5px] text-gy400 py-4">Cargando…</div>
                ) : !mensajes.length ? (
                  <div className="text-center text-[11px] text-gy400 py-4 px-3">
                    {seleccionada && gruposAjenos.has(seleccionada)
                      ? "No sos miembro de este grupo: se lo puede mandar igual, pero no vas a ver el historial ni las respuestas."
                      : "Ningún mensaje todavía"}
                  </div>
                ) : (
                  mensajes.map((m) => {
                    const propio = m.remitente_id === me.id;
                    const remitente = remitenteDe(m);
                    return (
                      <div key={m.id} className={cn("flex", propio ? "justify-end" : "justify-start")}>
                        <div className={cn(
                          "max-w-[80%] rounded-[10px] px-2.5 py-1.5 text-[11.5px] shadow-sm",
                          propio ? "bg-g700 text-white rounded-br-[3px]" : "bg-white text-gy900 rounded-bl-[3px] border border-gy200"
                        )}>
                          {!propio && conversacionActual?.tipo !== "dm" && (
                            <div className="text-[9.5px] font-semibold text-g700 mb-0.5">{remitente?.nombre ?? "—"}</div>
                          )}
                          {m.adjunto_url && m.adjunto_tipo === "imagen" && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.adjunto_url} alt={m.adjunto_nombre ?? "Adjunto"} className="rounded-[6px] max-w-full mb-1" />
                          )}
                          {m.adjunto_url && m.adjunto_tipo !== "imagen" && (
                            <a href={m.adjunto_url} target="_blank" rel="noopener noreferrer"
                              className={cn("flex items-center gap-1 underline mb-1", propio ? "text-white" : "text-g700")}>
                              <i className="ti ti-paperclip text-[12px]" /> {m.adjunto_nombre ?? "Archivo"}
                            </a>
                          )}
                          {m.contenido && <div className="whitespace-pre-wrap break-words">{m.contenido}</div>}
                          <div className={cn("text-[9px] mt-0.5 text-right", propio ? "text-white/70" : "text-gy400")}>
                            {formatTime(m.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={mensajesEndRef} />
              </div>
              {puedeEscribir ? (
                <div className="shrink-0 bg-white border-t border-gy200 p-2 flex items-end gap-1.5">
                  <textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarMensaje(); } }}
                    placeholder="Escribir…"
                    rows={1}
                    className="flex-1 resize-none px-2.5 py-1.5 border-2 border-gy200 rounded-[8px] text-[11.5px] bg-gy50 focus:outline-none focus:border-g500 max-h-20"
                  />
                  <button onClick={enviarMensaje} disabled={!texto.trim() || enviando}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[8px] bg-g700 text-white hover:bg-g800 disabled:opacity-40">
                    <i className="ti ti-send text-[13px]" />
                  </button>
                </div>
              ) : (
                <div className="shrink-0 bg-gy50 border-t border-gy200 px-3 py-2.5 text-center text-[10.5px] text-gy400">
                  Solo dueño y super admin pueden escribir en General
                </div>
              )}
            </>
          )}
        </div>
      )}

      {mostrarNuevo && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => setMostrarNuevo(false)}>
          <div className="bg-white rounded-[14px] shadow-xl w-full max-w-[360px] max-h-[60vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-3 border-b border-gy100 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-gy900">Nuevo mensaje</span>
              <button onClick={() => setMostrarNuevo(false)} className="text-gy400 hover:text-gy700">
                <i className="ti ti-x text-[16px]" />
              </button>
            </div>
            <div className="p-2.5 border-b border-gy100">
              <input
                autoFocus
                value={buscarContacto}
                onChange={(e) => setBuscarContacto(e.target.value)}
                placeholder="Buscar por nombre o mail…"
                className="w-full px-2.5 py-1.5 border-2 border-gy200 rounded-[8px] text-[11.5px] bg-gy50 focus:outline-none focus:border-g500"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {gruposFiltrados.length > 0 && (
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gy400 uppercase tracking-wide">
                  Grupos — mandar sin ser miembro
                </div>
              )}
              {gruposFiltrados.map((g) => (
                <button key={g.id} onClick={() => abrirGrupo(g)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gy50 border-b border-gy50">
                  <div className="w-7 h-7 rounded-full bg-g100 text-g700 flex items-center justify-center text-[12px] shrink-0">
                    <i className="ti ti-hash" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11.5px] font-medium text-gy900 truncate">{g.nombre ?? "Grupo"}</div>
                  </div>
                </button>
              ))}
              {contactosFiltrados.length > 0 && (
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gy400 uppercase tracking-wide">
                  Personas
                </div>
              )}
              {contactosFiltrados.map((c) => (
                <button key={c.id} onClick={() => abrirDM(c.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gy50 border-b border-gy50">
                  <div className="w-7 h-7 rounded-full bg-gy100 text-gy600 flex items-center justify-center text-[9px] font-bold shrink-0">
                    {initials(c.nombre)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11.5px] font-medium text-gy900 truncate">{c.nombre}</div>
                    <div className="text-[10px] text-gy400 truncate">{c.email}</div>
                  </div>
                </button>
              ))}
              {!contactosFiltrados.length && !gruposFiltrados.length && (
                <div className="p-5 text-center text-[11.5px] text-gy400">Sin resultados</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
