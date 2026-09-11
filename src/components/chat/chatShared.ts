export interface Perfil {
  id: string;
  nombre: string;
  email: string;
  rol?: string;
}

export interface Miembro {
  profile_id: string;
  last_read_at?: string;
  profiles: Perfil | Perfil[] | null;
}

export interface Conversacion {
  id: string;
  tipo: "dm" | "grupo" | "general";
  nombre: string | null;
  dm_clave: string | null;
  created_at: string;
  chat_miembros: Miembro[];
}

export interface Mensaje {
  id: string;
  conversacion_id: string;
  remitente_id: string;
  contenido: string | null;
  adjunto_url: string | null;
  adjunto_tipo: string | null;
  adjunto_nombre: string | null;
  created_at: string;
  // Perfil de quien lo mandó, embebido directo en el mensaje — no alcanza
  // con cruzar contra chat_miembros de la conversación porque alguien
  // puede mandar un mensaje a un grupo sin ser miembro (difusión).
  remitente?: Perfil | Perfil[] | null;
}

export interface Grupo {
  id: string;
  nombre: string | null;
}

export interface UltimoMensaje {
  conversacion_id: string;
  contenido: string | null;
  adjunto_tipo: string | null;
  remitente_id: string;
  created_at: string;
}

// Supabase devuelve la relación embebida como array cuando no puede inferir
// que es 1-a-1 a partir del select plano (sin tipos generados); acá se
// normaliza a un solo perfil o null.
export function perfilDe(m: Miembro | undefined): Perfil | null {
  if (!m) return null;
  return Array.isArray(m.profiles) ? (m.profiles[0] ?? null) : m.profiles;
}

export function remitenteDe(m: Mensaje): Perfil | null {
  if (!m.remitente) return null;
  return Array.isArray(m.remitente) ? (m.remitente[0] ?? null) : m.remitente;
}

export function nombreConversacion(c: Conversacion, meId: string): string {
  if (c.tipo === "general") return "General";
  if (c.tipo === "grupo") return c.nombre ?? "Grupo";
  const otro = perfilDe(c.chat_miembros.find((m) => m.profile_id !== meId));
  return otro?.nombre ?? "Conversación";
}

export function iconoConversacion(c: Conversacion): string {
  if (c.tipo === "general") return "ti-users";
  if (c.tipo === "grupo") return "ti-hash";
  return "ti-user";
}

// Sin leer: el último mensaje es más nuevo que mi last_read_at y no lo
// mandé yo mismo. Sin fila propia en chat_miembros (grupo ajeno abierto
// solo para mandar, o General) no hay nada que marcar como leído.
export function tieneNoLeidos(c: Conversacion, meId: string, ultimo: UltimoMensaje | undefined): boolean {
  if (!ultimo || ultimo.remitente_id === meId) return false;
  const miMiembro = c.chat_miembros.find((m) => m.profile_id === meId);
  if (!miMiembro?.last_read_at) return false;
  return ultimo.created_at > miMiembro.last_read_at;
}

export const SELECT_CONVERSACIONES =
  "id, tipo, nombre, dm_clave, created_at, chat_miembros(profile_id, last_read_at, profiles(id, nombre, email))";

export const SELECT_MENSAJE =
  "id, conversacion_id, remitente_id, contenido, adjunto_url, adjunto_tipo, adjunto_nombre, created_at, remitente:remitente_id(id, nombre, email)";
