"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn, initials } from "@/lib/utils/format";
import { formatTime } from "@/lib/utils/dates";
import { toast } from "@/components/ui/ToastNotification";
import { notificarMensajeChat, pedirPermisoNotificaciones } from "@/lib/utils/notificaciones";
import {
  type Perfil, type Conversacion, type Mensaje, type UltimoMensaje, type Grupo,
  remitenteDe, nombreConversacion, iconoConversacion, tieneNoLeidos,
} from "@/components/chat/chatShared";

export function ChatApp({
  me,
  conversacionesIniciales,
  contactos,
  ultimosMensajes,
  errorContactos,
}: {
  me: Perfil;
  conversacionesIniciales: Conversacion[];
  contactos: Perfil[];
  ultimosMensajes: UltimoMensaje[];
  errorContactos?: string | null;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (errorContactos) toast("error", "No se pudieron cargar los contactos: " + errorContactos);
    pedirPermisoNotificaciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [conversaciones, setConversaciones] = useState(conversacionesIniciales);
  useEffect(() => setConversaciones(conversacionesIniciales), [conversacionesIniciales]);

  const [ultimos, setUltimos] = useState(ultimosMensajes);
  useEffect(() => setUltimos(ultimosMensajes), [ultimosMensajes]);

  const [seleccionada, setSeleccionada] = useState<string | null>(conversaciones[0]?.id ?? null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargandoMensajes, setCargandoMensajes] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [subiendoArchivo, setSubiendoArchivo] = useState(false);
  const [mostrarNuevo, setMostrarNuevo] = useState(false);
  const [buscarContacto, setBuscarContacto] = useState("");
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  // Grupos que se abrieron para mandar un mensaje sin ser miembro: al
  // mandar el primer mensaje se crea (o reutiliza) una conversación
  // privada aparte con los miembros del grupo, ver resolverDestino.
  const [gruposAjenos, setGruposAjenos] = useState<Set<string>>(new Set());

  const fileInput = useRef<HTMLInputElement>(null);
  const mensajesEndRef = useRef<HTMLDivElement>(null);

  // Refs para leer el estado más reciente desde el listener global de
  // mensajes nuevos (abajo) sin tener que resuscribirlo en cada cambio.
  const seleccionadaRef = useRef(seleccionada);
  useEffect(() => { seleccionadaRef.current = seleccionada; }, [seleccionada]);
  const contactosRef = useRef(contactos);
  useEffect(() => { contactosRef.current = contactos; }, [contactos]);
  const conversacionesRef = useRef(conversaciones);
  useEffect(() => { conversacionesRef.current = conversaciones; }, [conversaciones]);

  // Última preview por conversación, a partir de los últimos 200 mensajes
  // (ya vienen ordenados desc desde el server).
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

  const conversacionActual = conversaciones.find((c) => c.id === seleccionada) ?? null;
  // Solo dueño y super_admin pueden escribir en General — el resto lo
  // sigue leyendo, no cambia nada más.
  const puedeEscribir =
    conversacionActual?.tipo !== "general" || me.rol === "dueno" || me.rol === "super_admin";

  // Marca como leída la conversación (fila propia en chat_miembros): sin
  // fila (grupo ajeno abierto solo para mandar, o General) no actualiza
  // nada, no hace falta filtrar antes de llamarla.
  function marcarLeido(conversacionId: string) {
    const ahora = new Date().toISOString();
    setConversaciones((prev) => prev.map((c) => c.id !== conversacionId ? c : {
      ...c,
      chat_miembros: c.chat_miembros.map((m) => m.profile_id === me.id ? { ...m, last_read_at: ahora } : m),
    }));
    supabase.from("chat_miembros").update({ last_read_at: ahora })
      .eq("conversacion_id", conversacionId).eq("profile_id", me.id).then();
  }

  // Carga de mensajes + realtime al cambiar de conversación seleccionada.
  // Se pide a /api/chat/mensajes (service role) porque el select trae
  // remitente:remitente_id(...) embebido, y esa relación pasa por profiles
  // — cuya política de SELECT no deja leer perfiles ajenos a cualquier rol.
  useEffect(() => {
    if (!seleccionada) { setMensajes([]); return; }
    let activo = true;
    setCargandoMensajes(true);
    fetch(`/api/chat/mensajes?conversacion_id=${seleccionada}`)
      .then((r) => r.json())
      .then((json) => {
        if (!activo) return;
        if (json.error) toast("error", "No se pudieron cargar los mensajes: " + json.error);
        setMensajes((json.mensajes ?? []) as Mensaje[]);
        setCargandoMensajes(false);
      });
    marcarLeido(seleccionada);

    const canal = supabase
      .channel(`chat-${seleccionada}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_mensajes", filter: `conversacion_id=eq.${seleccionada}` },
        (payload) => {
          // El evento realtime trae solo las columnas propias del mensaje,
          // sin el remitente embebido (eso es cosa de PostgREST, no de
          // Realtime) — se completa a mano desde lo que ya se tiene.
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

    return () => {
      activo = false;
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionada, supabase]);

  // Avisa cuando llega una conversación nueva (alguien inició un DM conmigo,
  // o me sumaron a un grupo): refresca la lista completa desde el server.
  useEffect(() => {
    const canal = supabase
      .channel(`chat-miembros-${me.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_miembros", filter: `profile_id=eq.${me.id}` },
        () => router.refresh()
      )
      .subscribe();
    return () => { supabase.removeChannel(canal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id, supabase]);

  // Avisa (vibración + sonido + notificación del sistema) ante CUALQUIER
  // mensaje nuevo de mis conversaciones, esté abierta esa conversación o no
  // — a diferencia del canal de arriba (línea ~114, que solo escucha la
  // conversación seleccionada), este no filtra por conversacion_id porque
  // Realtime no soporta filtrar por "está en esta lista de ids"; se filtra
  // a mano. Se omite el aviso si ya estoy mirando esa conversación con la
  // pestaña activa.
  useEffect(() => {
    const canal = supabase
      .channel(`chat-mensajes-todos-${me.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_mensajes" },
        (payload) => {
          const cruda = payload.new as Mensaje;
          if (cruda.remitente_id === me.id) return;
          if (!conversacionesRef.current.some((c) => c.id === cruda.conversacion_id)) return;

          setUltimos((prev) => [
            { conversacion_id: cruda.conversacion_id, contenido: cruda.contenido, adjunto_tipo: cruda.adjunto_tipo, remitente_id: cruda.remitente_id, created_at: cruda.created_at },
            ...prev,
          ]);

          const yaViendola = seleccionadaRef.current === cruda.conversacion_id && document.visibilityState === "visible";
          if (yaViendola) return;
          const remitente = contactosRef.current.find((c) => c.id === cruda.remitente_id);
          const preview = cruda.adjunto_tipo ? (cruda.adjunto_tipo === "imagen" ? "📷 Foto" : "📎 Archivo") : (cruda.contenido ?? "Nuevo mensaje");
          notificarMensajeChat(remitente?.nombre ?? "Chat interno", preview);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(canal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id, supabase]);

  useEffect(() => {
    mensajesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes]);

  // La lista de grupos para elegir como destino (incluye los que no son
  // propios) se trae recién al abrir el modal, no de arranque.
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

    // Se resuelve en el servidor (con service role): recién creada, la
    // conversación no tiene miembros todavía, y la política de SELECT exige
    // ser miembro (o ser General) — armarla en dos inserts desde el navegador
    // fallaba porque ni el propio creador podía releerla para confirmar.
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

  // Al mandarle un primer mensaje a un grupo ajeno no se suma al grupo
  // compartido (ahí vería los mensajes de cualquier otro ajeno que
  // también le haya escrito, y viceversa) — se le crea una conversación
  // aparte, privada, solo entre esta persona y los miembros actuales del
  // grupo. Si ya le había escrito antes, reutiliza esa misma conversación
  // en vez de crear otra. Devuelve el id real al que hay que mandar el
  // mensaje (null si falló).
  async function resolverDestino(): Promise<string | null> {
    if (!seleccionada) return null;
    if (!gruposAjenos.has(seleccionada)) return seleccionada;

    const res = await fetch("/api/chat/grupos/privado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grupoId: seleccionada }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.conversacionId) { toast("error", json.error ?? "No se pudo enviar el mensaje"); return null; }

    const nuevaId = json.conversacionId as string;
    const anteriorId = seleccionada;
    setConversaciones((prev) => {
      const sinPlaceholder = prev.filter((c) => c.id !== anteriorId);
      if (sinPlaceholder.some((c) => c.id === nuevaId)) return sinPlaceholder;
      const conv = json.conversacion;
      const nuevaConv: Conversacion = conv
        ? { ...conv, chat_miembros: [] }
        : { id: nuevaId, tipo: "grupo", nombre: null, dm_clave: null, created_at: new Date().toISOString(), chat_miembros: [] };
      return [...sinPlaceholder, nuevaConv];
    });
    setGruposAjenos((prev) => { const s = new Set(prev); s.delete(anteriorId); return s; });
    setSeleccionada(nuevaId);
    return nuevaId;
  }

  async function enviarMensaje() {
    const contenido = texto.trim();
    if (!contenido || !seleccionada || enviando) return;
    setEnviando(true);
    const destino = await resolverDestino();
    if (!destino) { setEnviando(false); return; }
    // El id se genera acá y se manda explícito en el insert (sin encadenar
    // .select()): pedirle a Postgres que devuelva la fila recién insertada
    // (Prefer: return=representation) obliga a repasar la política de
    // SELECT sobre esa fila en la misma vuelta — mismo problema de orden
    // que tuvo la creación de un DM. Al no pedir nada de vuelta, el insert
    // sólo depende del WITH CHECK y no hace falta releer nada.
    const id = crypto.randomUUID();
    const nuevo: Mensaje = {
      id, conversacion_id: destino, remitente_id: me.id, contenido,
      adjunto_url: null, adjunto_tipo: null, adjunto_nombre: null, created_at: new Date().toISOString(), remitente: me,
    };
    const { error } = await supabase
      .from("chat_mensajes")
      .insert({ id, conversacion_id: destino, remitente_id: me.id, contenido });
    setEnviando(false);
    if (error) { toast("error", error.message || "No se pudo enviar el mensaje"); return; }
    setTexto("");
    // Dedupe por id evita que se duplique si el propio evento realtime
    // también llega.
    setMensajes((prev) => (prev.some((m) => m.id === nuevo.id) ? prev : [...prev, nuevo]));
  }

  async function adjuntarArchivo(files: FileList | null) {
    if (!files?.length || !seleccionada) return;
    const file = files[0];
    setSubiendoArchivo(true);
    const destino = await resolverDestino();
    if (!destino) { setSubiendoArchivo(false); return; }
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `${destino}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("chat-adjuntos").upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream",
    });
    if (upErr) {
      toast("error", "No se pudo subir el archivo");
      setSubiendoArchivo(false);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    const url = supabase.storage.from("chat-adjuntos").getPublicUrl(path).data.publicUrl;
    const tipo = file.type.startsWith("image/") ? "imagen" : "archivo";
    const id = crypto.randomUUID();
    const nuevo: Mensaje = {
      id, conversacion_id: destino, remitente_id: me.id, contenido: null,
      adjunto_url: url, adjunto_tipo: tipo, adjunto_nombre: file.name, created_at: new Date().toISOString(), remitente: me,
    };
    const { error } = await supabase
      .from("chat_mensajes")
      .insert({ id, conversacion_id: destino, remitente_id: me.id, adjunto_url: url, adjunto_tipo: tipo, adjunto_nombre: file.name });
    setSubiendoArchivo(false);
    if (fileInput.current) fileInput.current.value = "";
    if (error) { toast("error", error.message || "No se pudo enviar el adjunto"); return; }
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

  return (
    <div className="flex-1 flex min-h-0">
      {/* Lista de conversaciones */}
      <div className="w-[280px] shrink-0 border-r border-gy200 bg-white flex flex-col min-h-0">
        <div className="p-3 border-b border-gy100">
          <button
            onClick={() => setMostrarNuevo(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-medium bg-g700 text-white rounded-[8px] hover:bg-g800"
          >
            <i className="ti ti-edit text-[14px]" /> Nuevo mensaje
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {listaOrdenada.map((c) => {
            const preview = previewPorConversacion.get(c.id);
            const nombre = nombreConversacion(c, me.id);
            const activa = c.id === seleccionada;
            const noLeida = tieneNoLeidos(c, me.id, preview);
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => setSeleccionada(c.id)}
                onKeyDown={(e) => { if (e.key === "Enter") setSeleccionada(c.id); }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-gy50 hover:bg-gy50 cursor-pointer",
                  activa && "bg-g50"
                )}
              >
                <div className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold",
                  c.tipo === "dm" ? "bg-gy100 text-gy600" : "bg-g100 text-g700"
                )}>
                  {c.tipo === "dm" ? initials(nombre) : <i className={cn("ti", iconoConversacion(c), "text-[15px]")} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={cn("text-[12.5px] truncate", noLeida ? "font-bold text-gy900" : "font-semibold text-gy900")}>{nombre}</div>
                  <div className={cn("text-[11px] truncate", noLeida ? "text-gy700 font-medium" : "text-gy400")}>
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
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded-[6px] text-gy300 hover:text-red-600 hover:bg-red-50"
                  >
                    <i className="ti ti-trash text-[13px]" />
                  </button>
                )}
              </div>
            );
          })}
          {!listaOrdenada.length && (
            <div className="p-6 text-center text-[12px] text-gy400">Sin conversaciones todavía</div>
          )}
        </div>
      </div>

      {/* Panel de mensajes */}
      <div className="flex-1 flex flex-col min-h-0 bg-gy50">
        {!conversacionActual ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-gy400">
            Elegí una conversación para empezar
          </div>
        ) : (
          <>
            <div className="h-[52px] shrink-0 bg-white border-b border-gy200 flex items-center px-4 gap-2.5">
              <i className={cn("ti", iconoConversacion(conversacionActual), "text-[16px] text-g600")} />
              <span className="text-[13px] font-semibold text-gy900">{nombreConversacion(conversacionActual, me.id)}</span>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
              {cargandoMensajes ? (
                <div className="text-center text-[12px] text-gy400 py-6">Cargando…</div>
              ) : !mensajes.length ? (
                <div className="text-center text-[12px] text-gy400 py-6 px-4">
                  {seleccionada && gruposAjenos.has(seleccionada)
                    ? "No sos miembro de este grupo. Al mandar un mensaje se crea una conversación aparte, privada, solo entre vos y los miembros actuales del grupo."
                    : "Ningún mensaje todavía — escribí el primero"}
                </div>
              ) : (
                mensajes.map((m) => {
                  const propio = m.remitente_id === me.id;
                  const remitente = remitenteDe(m);
                  return (
                    <div key={m.id} className={cn("flex", propio ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[65%] rounded-[12px] px-3 py-2 text-[12.5px] shadow-sm",
                        propio ? "bg-g700 text-white rounded-br-[3px]" : "bg-white text-gy900 rounded-bl-[3px] border border-gy200"
                      )}>
                        {!propio && conversacionActual.tipo !== "dm" && (
                          <div className="text-[10px] font-semibold text-g700 mb-0.5">{remitente?.nombre ?? "—"}</div>
                        )}
                        {m.adjunto_url && m.adjunto_tipo === "imagen" && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.adjunto_url} alt={m.adjunto_nombre ?? "Adjunto"} className="rounded-[8px] max-w-full mb-1" />
                        )}
                        {m.adjunto_url && m.adjunto_tipo !== "imagen" && (
                          <a href={m.adjunto_url} target="_blank" rel="noopener noreferrer"
                            className={cn("flex items-center gap-1.5 underline mb-1", propio ? "text-white" : "text-g700")}>
                            <i className="ti ti-paperclip text-[13px]" /> {m.adjunto_nombre ?? "Archivo"}
                          </a>
                        )}
                        {m.contenido && <div className="whitespace-pre-wrap break-words">{m.contenido}</div>}
                        <div className={cn("text-[9.5px] mt-0.5 text-right", propio ? "text-white/70" : "text-gy400")}>
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
              <div className="shrink-0 bg-white border-t border-gy200 p-3 flex items-end gap-2">
                <input ref={fileInput} type="file" className="hidden" onChange={(e) => adjuntarArchivo(e.target.files)} />
                <button type="button" onClick={() => fileInput.current?.click()} disabled={subiendoArchivo}
                  className="shrink-0 w-9 h-9 flex items-center justify-center rounded-[8px] border-2 border-gy200 text-gy400 hover:text-g600 hover:border-g400 disabled:opacity-50">
                  {subiendoArchivo
                    ? <span className="w-3.5 h-3.5 border-2 border-gy300 border-t-g600 rounded-full animate-spin" />
                    : <i className="ti ti-paperclip text-[16px]" />}
                </button>
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarMensaje(); } }}
                  placeholder="Escribir un mensaje…"
                  rows={1}
                  className="flex-1 resize-none px-3 py-2 border-2 border-gy200 rounded-[8px] text-[12.5px] bg-gy50 focus:outline-none focus:border-g500 max-h-28"
                />
                <button onClick={enviarMensaje} disabled={!texto.trim() || enviando}
                  className="shrink-0 w-9 h-9 flex items-center justify-center rounded-[8px] bg-g700 text-white hover:bg-g800 disabled:opacity-40">
                  <i className="ti ti-send text-[15px]" />
                </button>
              </div>
            ) : (
              <div className="shrink-0 bg-gy50 border-t border-gy200 px-4 py-3 text-center text-[11.5px] text-gy400">
                Solo dueño y super admin pueden escribir en General
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal: nuevo mensaje */}
      {mostrarNuevo && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setMostrarNuevo(false)}>
          <div className="bg-white rounded-[14px] shadow-xl w-full max-w-[420px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gy100 flex items-center justify-between">
              <span className="text-[14px] font-semibold text-gy900">Nuevo mensaje</span>
              <button onClick={() => setMostrarNuevo(false)} className="text-gy400 hover:text-gy700">
                <i className="ti ti-x text-[18px]" />
              </button>
            </div>
            <div className="p-3 border-b border-gy100">
              <input
                autoFocus
                type="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                name="buscar-contacto-chat"
                value={buscarContacto}
                onChange={(e) => setBuscarContacto(e.target.value)}
                placeholder="Buscar por nombre o mail…"
                className="w-full px-3 py-2 border-2 border-gy200 rounded-[8px] text-[12.5px] bg-gy50 focus:outline-none focus:border-g500"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {gruposFiltrados.length > 0 && (
                <div className="px-4 pt-2.5 pb-1 text-[10.5px] font-semibold text-gy400 uppercase tracking-wide">
                  Grupos — se abre una conversación privada aparte
                </div>
              )}
              {gruposFiltrados.map((g) => (
                <button key={g.id} onClick={() => abrirGrupo(g)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-gy50 border-b border-gy50">
                  <div className="w-8 h-8 rounded-full bg-g100 text-g700 flex items-center justify-center text-[13px] shrink-0">
                    <i className="ti ti-hash" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium text-gy900 truncate">{g.nombre ?? "Grupo"}</div>
                  </div>
                </button>
              ))}
              {contactosFiltrados.length > 0 && (
                <div className="px-4 pt-2.5 pb-1 text-[10.5px] font-semibold text-gy400 uppercase tracking-wide">
                  Personas
                </div>
              )}
              {contactosFiltrados.map((c) => (
                <button key={c.id} onClick={() => abrirDM(c.id)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-gy50 border-b border-gy50">
                  <div className="w-8 h-8 rounded-full bg-gy100 text-gy600 flex items-center justify-center text-[10px] font-bold shrink-0">
                    {initials(c.nombre)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium text-gy900 truncate">{c.nombre}</div>
                    <div className="text-[11px] text-gy400 truncate">{c.email}</div>
                  </div>
                </button>
              ))}
              {!contactosFiltrados.length && !gruposFiltrados.length && (
                <div className="p-6 text-center text-[12px] text-gy400">Sin resultados</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
