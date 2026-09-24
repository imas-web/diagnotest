import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// retiros.pedido_id no tiene foreign key declarada en el schema, así que
// PostgREST no puede resolver un embed tipo "pedido:pedido_id(detalle)" —
// se busca a mano y se pega como campo plano (retiro.pedido_detalle) para
// que ControlCard lo muestre sin depender de esa relación.
export async function adjuntarIndicacionesPedido(supabase: SupabaseClient, controles: AnyRecord[]) {
  const pedidoIds = Array.from(
    new Set(controles.map((c) => (c.retiro as AnyRecord)?.pedido_id).filter(Boolean))
  ) as string[];
  if (!pedidoIds.length) return controles;

  const { data: pedidos } = await supabase.from("pedidos_retiro").select("id, detalle").in("id", pedidoIds);
  const detallePorId = new Map((pedidos ?? []).map((p) => [p.id, p.detalle]));

  for (const c of controles) {
    const retiro = c.retiro as AnyRecord;
    if (retiro?.pedido_id) retiro.pedido_detalle = detallePorId.get(retiro.pedido_id) ?? null;
  }
  return controles;
}
