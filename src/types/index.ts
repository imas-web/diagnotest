export type UserRole =
  | "personal_logistica"
  | "jefe_logistica"
  | "preanalitica"
  | "cobranzas"
  | "dueno"
  | "super_admin"
  | "carga"
  | "chat";

export type TipoPersonal = "fijo" | "reemplazo" | "ventanilla";

export type TipoRetiro = "veterinaria" | "ventanilla" | "reemplazo" | "otro";

export type MetodoPago = "efectivo" | "transferencia" | "mercado_pago";

export type EstadoRetiro =
  | "registrado"
  | "en_proceso"
  | "controlado"
  | "finalizado"
  | "anulado";

export type EstadoPreanalitica =
  | "pendiente"
  | "ok"
  | "observado"
  | "rechazado";

export type EstadoCobranzas =
  | "pendiente"
  | "adjudicado"
  | "diferencia"
  | "no_corresponde";

export type EstadoPedido =
  | "asignado"
  | "en_proceso"
  | "resuelto"
  | "vencido"
  | "cancelado";

export type TipoGasto = "gasto" | "retiro_dinero";

export type EstadoGasto =
  | "pendiente"
  | "autorizado"
  | "observado"
  | "rechazado";

export interface Profile {
  id: string;
  nombre: string;
  email: string;
  rol: UserRole;
  activo: boolean;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Zona {
  id: string;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
}

export interface Personal {
  id: string;
  profile_id: string;
  nombre: string;
  zona_base_id: string;
  tipo: TipoPersonal;
  activo: boolean;
  observaciones: string | null;
  zona?: Zona;
  profile?: Profile;
}

export interface Veterinaria {
  id: string;
  codigo: string;
  nombre: string;
  direccion: string | null;
  zona_id: string;
  condicion_facturacion: string | null;
  activa: boolean;
  observaciones: string | null;
  zona?: Zona;
}

export interface Retiro {
  id: string;
  timestamp_carga: string;
  fecha_operativa: string;
  personal_id: string;
  veterinaria_id: string | null;
  veterinaria_texto_original: string;
  codigo_original: string | null;
  cantidad_muestras: number;
  importe_declarado: number;
  metodo_pago: MetodoPago | null;
  comprobante_url: string | null;
  comentarios: string | null;
  tipo: TipoRetiro;
  urgente: boolean;
  estado: EstadoRetiro;
  latitud: number | null;
  longitud: number | null;
  sincronizado: boolean;
  pedido_id: string | null;
  created_by: string;
  anulado: boolean;
  personal?: Personal;
  veterinaria?: Veterinaria;
  control_preanalitica?: ControlPreanalitica;
  control_cobranzas?: ControlCobranzas;
}

export interface ControlPreanalitica {
  id: string;
  retiro_id: string;
  estado: EstadoPreanalitica;
  control_1: string | null;
  control_2: string | null;
  urgente: boolean;
  detalle: string | null;
  responsable_id: string | null;
  cancelado: boolean;
  cancelado_motivo: string | null;
  cancelado_por: string | null;
  cancelado_at: string | null;
  comentario: string | null;
  created_at: string;
  updated_at: string;
  responsable?: Profile;
}

export interface ControlCobranzas {
  id: string;
  retiro_id: string;
  estado: EstadoCobranzas;
  importe_declarado: number;
  importe_validado: number | null;
  diferencia: number | null;
  detalle: string | null;
  medio_pago: string | null;
  responsable_id: string | null;
  created_at: string;
  updated_at: string;
  responsable?: Profile;
}

export interface PedidoRetiro {
  id: string;
  veterinaria_id: string;
  personal_asignado_id: string;
  creado_por_id: string;
  estado: EstadoPedido;
  urgente: boolean;
  detalle: string | null;
  fecha_limite: string;
  resuelto_en: string | null;
  retiro_id: string | null;
  reasignaciones: number;
  created_at: string;
  veterinaria?: Veterinaria;
  personal_asignado?: Personal;
  creado_por?: Profile;
}

export interface Gasto {
  id: string;
  personal_id: string;
  tipo: TipoGasto;
  descripcion: string;
  monto: number;
  fecha_operativa: string;
  comprobante_url: string | null;
  estado: EstadoGasto;
  autorizado_por: string | null;
  observacion_jefe: string | null;
  respuesta_personal: string | null;
  created_at: string;
  updated_at: string;
  personal?: Personal;
  autorizado_por_profile?: Profile;
}

export interface Auditoria {
  id: string;
  entidad: string;
  entidad_id: string;
  accion: string;
  campo_modificado: string | null;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  usuario_id: string;
  fecha_hora: string;
  usuario?: Profile;
}

export interface RetiroOffline
  extends Omit<Retiro, "personal" | "veterinaria" | "control_preanalitica" | "control_cobranzas"> {
  _offline?: boolean;
  _sync_attempts?: number;
}

export interface SyncQueueItem {
  id: string;
  action: "create" | "update" | "delete";
  table: string;
  data: Record<string, unknown>;
  timestamp: number;
  attempts: number;
}

export interface DashboardKPIs {
  retiros_hoy: number;
  retiros_mes: number;
  retiros_mes_anterior: number;
  muestras_hoy: number;
  muestras_mes: number;
  importe_registrado: number;
  importe_validado: number;
  pedidos_pendientes: number;
  pedidos_vencidos: number;
  pct_controlados_pre: number;
  pct_controlados_cob: number;
  urgentes_activos: number;
  gastos_pendientes_count: number;
  gastos_pendientes_monto: number;
  sin_codigo: number;
  importe_cero: number;
  duplicados_sospechosos: number;
}
