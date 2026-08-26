import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Herramientas de solo lectura para el chatbot de consultas. Cada una arma un
 * SELECT sobre el cliente Supabase autenticado del usuario (respeta RLS: cada
 * quien ve lo mismo que ya podría ver navegando la app). Ninguna hace insert,
 * update ni delete.
 */

const term = (s: string) => `%${s.trim()}%`;

async function resolveIds(
  supabase: SupabaseClient,
  table: string,
  column: string,
  nombre: string,
  limit = 15
) {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .ilike(column, term(nombre))
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { id: string }) => r.id);
}

async function resolveRetiroIds(
  supabase: SupabaseClient,
  filtros: {
    personal_nombre?: string;
    veterinaria?: string;
    fecha?: string;
    fecha_desde?: string;
    fecha_hasta?: string;
  }
): Promise<{ ids: string[] | null; sinResultados: boolean }> {
  const { personal_nombre, veterinaria, fecha, fecha_desde, fecha_hasta } = filtros;
  if (!personal_nombre && !veterinaria && !fecha && !fecha_desde && !fecha_hasta) {
    return { ids: null, sinResultados: false };
  }

  let query = supabase.from("retiros").select("id").limit(500);

  if (personal_nombre) {
    const personalIds = await resolveIds(supabase, "personal", "nombre", personal_nombre);
    if (personalIds.length === 0) return { ids: [], sinResultados: true };
    query = query.in("personal_id", personalIds);
  }
  if (veterinaria) {
    const [porNombre, porCodigo] = await Promise.all([
      resolveIds(supabase, "veterinarias", "nombre", veterinaria),
      resolveIds(supabase, "veterinarias", "codigo", veterinaria),
    ]);
    const vetIds = Array.from(new Set([...porNombre, ...porCodigo]));
    if (vetIds.length === 0) return { ids: [], sinResultados: true };
    query = query.in("veterinaria_id", vetIds);
  }
  if (fecha) query = query.eq("fecha_operativa", fecha);
  if (fecha_desde) query = query.gte("fecha_operativa", fecha_desde);
  if (fecha_hasta) query = query.lte("fecha_operativa", fecha_hasta);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { ids: (data ?? []).map((r: { id: string }) => r.id), sinResultados: false };
}

const fechaFields = {
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Fecha operativa exacta, formato YYYY-MM-DD"),
  fecha_desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Desde esta fecha (inclusive), formato YYYY-MM-DD"),
  fecha_hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Hasta esta fecha (inclusive), formato YYYY-MM-DD"),
};

function capLimite(n: number | undefined, def = 25, max = 60) {
  if (!n) return def;
  return Math.min(Math.max(1, n), max);
}

export function buildChatbotTools(supabase: SupabaseClient) {
  const buscarPersonal = betaZodTool({
    name: "buscar_personal",
    description:
      "Busca personal de logística por nombre (búsqueda parcial). Útil para confirmar quién es quién antes de filtrar retiros u otras consultas.",
    inputSchema: z.object({
      nombre: z.string().optional().describe("Nombre o parte del nombre a buscar"),
      solo_activos: z.boolean().optional().default(true),
    }),
    run: async ({ nombre, solo_activos }) => {
      let query = supabase
        .from("personal")
        .select("id, nombre, tipo, activo, zona:zona_base_id(nombre)")
        .limit(30);
      if (nombre) query = query.ilike("nombre", term(nombre));
      if (solo_activos) query = query.eq("activo", true);
      const { data, error } = await query;
      if (error) return `Error: ${error.message}`;
      return JSON.stringify(data);
    },
  });

  const buscarVeterinarias = betaZodTool({
    name: "buscar_veterinarias",
    description: "Busca veterinarias por nombre, código o localidad (búsqueda parcial).",
    inputSchema: z.object({
      texto: z.string().describe("Nombre, código o localidad a buscar"),
    }),
    run: async ({ texto }) => {
      const { data, error } = await supabase
        .from("veterinarias")
        .select("id, codigo, nombre, localidad, direccion, telefono, activa")
        .or(`nombre.ilike.${term(texto)},codigo.ilike.${term(texto)},localidad.ilike.${term(texto)}`)
        .limit(20);
      if (error) return `Error: ${error.message}`;
      return JSON.stringify(data);
    },
  });

  const buscarRetiros = betaZodTool({
    name: "buscar_retiros",
    description:
      "Busca retiros (visitas a veterinarias) filtrando por personal, veterinaria, fecha y/o estado. Devuelve fecha, personal, veterinaria, muestras, importe declarado, estado y comentarios.",
    inputSchema: z.object({
      personal_nombre: z.string().optional().describe("Nombre del cadete/personal que hizo el retiro"),
      veterinaria: z.string().optional().describe("Nombre o código de la veterinaria"),
      ...fechaFields,
      estado: z
        .enum(["registrado", "en_proceso", "controlado", "finalizado", "anulado"])
        .optional(),
      urgente: z.boolean().optional(),
      incluir_anulados: z.boolean().optional().default(false),
      limite: z.number().int().optional().describe("Máximo de resultados (default 25, máx 60)"),
    }),
    run: async (input) => {
      const { ids, sinResultados } = await resolveRetiroIds(supabase, input);
      if (sinResultados) return "No se encontró personal o veterinaria que coincida con esa búsqueda.";

      let query = supabase
        .from("retiros")
        .select(
          "id, fecha_operativa, timestamp_carga, cantidad_muestras, importe_declarado, estado, urgente, anulado, comentarios, metodo_pago, personal:personal_id(nombre), veterinaria:veterinaria_id(nombre, codigo)"
        )
        .order("fecha_operativa", { ascending: false })
        .order("timestamp_carga", { ascending: false })
        .limit(capLimite(input.limite));

      if (ids) query = query.in("id", ids);
      if (!input.incluir_anulados) query = query.eq("anulado", false);
      if (input.estado) query = query.eq("estado", input.estado);
      if (input.urgente !== undefined) query = query.eq("urgente", input.urgente);

      const { data, error } = await query;
      if (error) return `Error: ${error.message}`;
      if (!data || data.length === 0) return "No se encontraron retiros con esos filtros.";
      return JSON.stringify(data);
    },
  });

  const buscarControlPreanalitica = betaZodTool({
    name: "buscar_control_preanalitica",
    description:
      "Busca el control de preanalítica de retiros: quién controló (responsable_1, responsable_2), estado del control (pendiente/ok/observado/rechazado), y comentarios. Filtra por personal que hizo el retiro, veterinaria, fecha y/o quién controló.",
    inputSchema: z.object({
      personal_nombre: z.string().optional().describe("Nombre del cadete/personal que hizo el retiro (no el que controló)"),
      veterinaria: z.string().optional(),
      ...fechaFields,
      responsable_nombre: z.string().optional().describe("Nombre de quien controló (busca en responsable_1 y responsable_2)"),
      estado: z.enum(["pendiente", "ok", "observado", "rechazado"]).optional(),
      urgente: z.boolean().optional(),
      limite: z.number().int().optional(),
    }),
    run: async (input) => {
      const { ids, sinResultados } = await resolveRetiroIds(supabase, input);
      if (sinResultados) return "No se encontró personal o veterinaria que coincida con esa búsqueda.";

      let query = supabase
        .from("control_preanalitica")
        .select(
          "id, estado, control_1, control_2, urgente, detalle, detalle_2, comentario, responsable_1, responsable_2, cancelado, cancelado_motivo, updated_at, retiro:retiro_id(fecha_operativa, personal:personal_id(nombre), veterinaria:veterinaria_id(nombre))"
        )
        .order("updated_at", { ascending: false })
        .limit(capLimite(input.limite));

      if (ids) query = query.in("retiro_id", ids);
      if (input.estado) query = query.eq("estado", input.estado);
      if (input.urgente !== undefined) query = query.eq("urgente", input.urgente);
      if (input.responsable_nombre) {
        query = query.or(
          `responsable_1.ilike.${term(input.responsable_nombre)},responsable_2.ilike.${term(input.responsable_nombre)}`
        );
      }

      const { data, error } = await query;
      if (error) return `Error: ${error.message}`;
      if (!data || data.length === 0) return "No se encontraron controles de preanalítica con esos filtros.";
      return JSON.stringify(data);
    },
  });

  const buscarControlCobranzas = betaZodTool({
    name: "buscar_control_cobranzas",
    description:
      "Busca el control de cobranzas de retiros: importe declarado vs validado, diferencia, medio de pago, estado y quién lo validó. Filtra por personal que hizo el retiro, veterinaria, fecha y/o quién validó.",
    inputSchema: z.object({
      personal_nombre: z.string().optional().describe("Nombre del cadete/personal que hizo el retiro"),
      veterinaria: z.string().optional(),
      ...fechaFields,
      responsable_nombre: z.string().optional().describe("Nombre de quien validó la cobranza"),
      estado: z.enum(["pendiente", "adjudicado", "diferencia", "no_corresponde"]).optional(),
      limite: z.number().int().optional(),
    }),
    run: async (input) => {
      const { ids, sinResultados } = await resolveRetiroIds(supabase, input);
      if (sinResultados) return "No se encontró personal o veterinaria que coincida con esa búsqueda.";

      let responsableIds: string[] | null = null;
      if (input.responsable_nombre) {
        responsableIds = await resolveIds(supabase, "profiles", "nombre", input.responsable_nombre);
        if (responsableIds.length === 0) return "No se encontró ningún usuario con ese nombre.";
      }

      let query = supabase
        .from("control_cobranzas")
        .select(
          "id, estado, importe_declarado, importe_validado, diferencia, detalle, medio_pago, updated_at, responsable:responsable_id(nombre), retiro:retiro_id(fecha_operativa, personal:personal_id(nombre), veterinaria:veterinaria_id(nombre))"
        )
        .order("updated_at", { ascending: false })
        .limit(capLimite(input.limite));

      if (ids) query = query.in("retiro_id", ids);
      if (input.estado) query = query.eq("estado", input.estado);
      if (responsableIds) query = query.in("responsable_id", responsableIds);

      const { data, error } = await query;
      if (error) return `Error: ${error.message}`;
      if (!data || data.length === 0) return "No se encontraron controles de cobranzas con esos filtros.";
      return JSON.stringify(data);
    },
  });

  const buscarPedidos = betaZodTool({
    name: "buscar_pedidos_retiro",
    description:
      "Busca pedidos de retiro (solicitudes de veterinarias) por veterinaria, personal asignado, estado o urgencia.",
    inputSchema: z.object({
      veterinaria: z.string().optional(),
      personal_nombre: z.string().optional().describe("Personal asignado al pedido"),
      estado: z.enum(["asignado", "en_proceso", "resuelto", "vencido", "cancelado"]).optional(),
      urgente: z.boolean().optional(),
      limite: z.number().int().optional(),
    }),
    run: async ({ veterinaria, personal_nombre, estado, urgente, limite }) => {
      let query = supabase
        .from("pedidos_retiro")
        .select(
          "id, estado, urgente, detalle, fecha_limite, resuelto_en, created_at, veterinaria:veterinaria_id(nombre, codigo), personal_asignado:personal_asignado_id(nombre), creado_por:creado_por_id(nombre)"
        )
        .order("created_at", { ascending: false })
        .limit(capLimite(limite));

      if (veterinaria) {
        const [porNombre, porCodigo] = await Promise.all([
          resolveIds(supabase, "veterinarias", "nombre", veterinaria),
          resolveIds(supabase, "veterinarias", "codigo", veterinaria),
        ]);
        const vetIds = Array.from(new Set([...porNombre, ...porCodigo]));
        if (vetIds.length === 0) return "No se encontró ninguna veterinaria que coincida con esa búsqueda.";
        query = query.in("veterinaria_id", vetIds);
      }
      if (personal_nombre) {
        const personalIds = await resolveIds(supabase, "personal", "nombre", personal_nombre);
        if (personalIds.length === 0) return "No se encontró personal que coincida con esa búsqueda.";
        query = query.in("personal_asignado_id", personalIds);
      }
      if (estado) query = query.eq("estado", estado);
      if (urgente !== undefined) query = query.eq("urgente", urgente);

      const { data, error } = await query;
      if (error) return `Error: ${error.message}`;
      if (!data || data.length === 0) return "No se encontraron pedidos con esos filtros.";
      return JSON.stringify(data);
    },
  });

  const buscarGastos = betaZodTool({
    name: "buscar_gastos",
    description:
      "Busca gastos y retiros de dinero cargados por el personal, con su estado de autorización.",
    inputSchema: z.object({
      personal_nombre: z.string().optional(),
      ...fechaFields,
      estado: z.enum(["pendiente", "autorizado", "observado", "rechazado"]).optional(),
      tipo: z.enum(["gasto", "retiro_dinero"]).optional(),
      limite: z.number().int().optional(),
    }),
    run: async ({ personal_nombre, fecha, fecha_desde, fecha_hasta, estado, tipo, limite }) => {
      let query = supabase
        .from("gastos")
        .select(
          "id, tipo, descripcion, monto, fecha_operativa, estado, observacion_jefe, respuesta_personal, personal:personal_id(nombre), autorizador:autorizado_por(nombre)"
        )
        .order("fecha_operativa", { ascending: false })
        .limit(capLimite(limite));

      if (personal_nombre) {
        const personalIds = await resolveIds(supabase, "personal", "nombre", personal_nombre);
        if (personalIds.length === 0) return "No se encontró personal que coincida con esa búsqueda.";
        query = query.in("personal_id", personalIds);
      }
      if (fecha) query = query.eq("fecha_operativa", fecha);
      if (fecha_desde) query = query.gte("fecha_operativa", fecha_desde);
      if (fecha_hasta) query = query.lte("fecha_operativa", fecha_hasta);
      if (estado) query = query.eq("estado", estado);
      if (tipo) query = query.eq("tipo", tipo);

      const { data, error } = await query;
      if (error) return `Error: ${error.message}`;
      if (!data || data.length === 0) return "No se encontraron gastos con esos filtros.";
      return JSON.stringify(data);
    },
  });

  return [
    buscarPersonal,
    buscarVeterinarias,
    buscarRetiros,
    buscarControlPreanalitica,
    buscarControlCobranzas,
    buscarPedidos,
    buscarGastos,
  ];
}
