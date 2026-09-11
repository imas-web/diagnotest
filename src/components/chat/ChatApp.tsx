"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn, initials } from "@/lib/utils/format";
import { formatTime } from "@/lib/utils/dates";
import { toast } from "@/components/ui/ToastNotification";

interface Perfil {
  id: string;
  nombre: string;
  email: string;
  rol?: string;
}

interface Miembro {
  profile_id: string;
  profiles: Perfil | Perfil[] | null;
}

interface Conversacion {
  id: string;
  tipo: "dm" | "grupo" | "general";
  nombre: string | null;
  dm_clave: string | null;
  created_at: string;
  chat_miembros: Miembro[];
}

// Supabase devuelve la relación embebida como array cuando no puede inferir
// que es 1-a-1 a partir del select plano (sin tipos generados); acá se
// normaliza a un solo perfil o null.
function perfilDe(m: Miembro | undefined): Perfil | null {
  if (!m) return null;
  return Array.isArray(m.profiles) ? (m.profiles[0] ?? null) : m.profiles;
}

interface Mensaje {
  id: string;
  conversacion_id: string;
  remitente_id: string;
  contenido: string | null;
  adjunto_url: string | null;
  adjunto_tipo: string | null;
  adjunto_nombre: string | null;
  created_at: string;
}

interface UltimoMensaje {
  conversacion_id: string;
  contenido: string | null;
  adjunto_tipo: string | null;
  remitente_id: string;
  created_at: string;
}

function nombreConversacion(c: Conversacion, meId: string): string {
  if (c.tipo === "general") return "General";
  if (c.tipo === "grupo") return c.nombre ?? "Grupo";
  const otro = perfilDe(c.chat_miembros.find((m) => m.profile_id !== meId));
  return otro?.nombre ?? "Conversación";
}

function iconoConversacion(c: Conversacion): string {
  if (c.tipo === "general") return "ti-users";
  if (c.tipo === "grupo") return "ti-hash";
  return "ti-user";
}

export function ChatApp({
  me,
  conversacionesIniciales,
  contactos,
  ultimosMensajes,
}: {
  me: Perfil;
  conversacionesIniciales: Conversacion[];
  contactos: Perfil[];
  ultimosMensajes: UltimoMensaje[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

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

  const fileInput = useRef<HTMLInputElement>(null);
  const mensajesEndRef = useRef<HTMLDivElement>(null);

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

  // Carga de mensajes + realtime al cambiar de conversación seleccionada.
  useEffect(() => {
    if (!seleccionada) { setMensajes([]); return; }
    let activo = true;
    setCargandoMensajes(true);
    supabase
      .from("chat_mensajes")
      .select("id, conversacion_id, remitente_id, contenido, adjunto_url, adjunto_tipo, adjunto_nombre, created_at")
      .eq("conversacion_id", seleccionada)
      .order("created_at", { ascending: true })
      .limit(500)
      .then(({ data }) => {
        if (!activo) return;
        setMensajes((data ?? []) as Mensaje[]);
        setCargandoMensajes(false);
      });

    const canal = supabase
      .channel(`chat-${seleccionada}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_mensajes", filter: `conversacion_id=eq.${seleccionada}` },
        (payload) => {
          const nuevo = payload.new as Mensaje;
          setMensajes((prev) => (prev.some((m) => m.id === nuevo.id) ? prev : [...prev, nuevo]));
        }
      )
      .subscribe();

    return () => {
      activo = false;
      supabase.removeChannel(canal);
    };
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

  useEffect(() => {
    mensajesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes]);

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

  async function enviarMensaje() {
    const contenido = texto.trim();
    if (!contenido || !seleccionada || enviando) return;
    setEnviando(true);
    const { error } = await supabase
      .from("chat_mensajes")
      .insert({ conversacion_id: seleccionada, remitente_id: me.id, contenido });
    setEnviando(false);
    if (error) { toast("error", "No se pudo enviar el mensaje"); return; }
    setTexto("");
  }

  async function adjuntarArchivo(files: FileList | null) {
    if (!files?.length || !seleccionada) return;
    const file = files[0];
    setSubiendoArchivo(true);
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `${seleccionada}/${crypto.randomUUID()}.${ext}`;
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
    const { error } = await supabase
      .from("chat_mensajes")
      .insert({ conversacion_id: seleccionada, remitente_id: me.id, adjunto_url: url, adjunto_tipo: tipo, adjunto_nombre: file.name });
    setSubiendoArchivo(false);
    if (fileInput.current) fileInput.current.value = "";
    if (error) toast("error", "No se pudo enviar el adjunto");
  }

  const contactosFiltrados = contactos.filter((c) => {
    const q = buscarContacto.trim().toLowerCase();
    if (!q) return true;
    return c.nombre.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
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
            return (
              <button
                key={c.id}
                onClick={() => setSeleccionada(c.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-gy50 hover:bg-gy50",
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
                  <div className="text-[12.5px] font-semibold text-gy900 truncate">{nombre}</div>
                  <div className="text-[11px] text-gy400 truncate">
                    {preview
                      ? preview.adjunto_tipo
                        ? (preview.remitente_id === me.id ? "Vos: " : "") + (preview.adjunto_tipo === "imagen" ? "📷 Foto" : "📎 Archivo")
                        : (preview.remitente_id === me.id ? "Vos: " : "") + (preview.contenido ?? "")
                      : "Sin mensajes todavía"}
                  </div>
                </div>
              </button>
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
                <div className="text-center text-[12px] text-gy400 py-6">Ningún mensaje todavía — escribí el primero</div>
              ) : (
                mensajes.map((m) => {
                  const propio = m.remitente_id === me.id;
                  const remitente = perfilDe(conversacionActual.chat_miembros.find((x) => x.profile_id === m.remitente_id));
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
                value={buscarContacto}
                onChange={(e) => setBuscarContacto(e.target.value)}
                placeholder="Buscar por nombre o mail…"
                className="w-full px-3 py-2 border-2 border-gy200 rounded-[8px] text-[12.5px] bg-gy50 focus:outline-none focus:border-g500"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
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
              {!contactosFiltrados.length && (
                <div className="p-6 text-center text-[12px] text-gy400">Sin resultados</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
