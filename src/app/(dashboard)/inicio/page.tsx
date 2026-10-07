import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MobileHome } from "@/components/mobile/MobileHome";
import { todayISO } from "@/lib/utils/dates";

export default async function InicioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, nombre, rol")
    .eq("id", user.id)
    .single();

  // Solo personal de logística usa la vista mobile; el resto al dashboard
  if (profile?.rol !== "personal_logistica") redirect("/dashboard");

  const { data: personal } = await supabase
    .from("personal")
    .select("id, nombre, zona:zona_base_id(nombre)")
    .eq("profile_id", user.id)
    .single();

  const personalId = personal?.id ?? "";
  const zonaNombre = (personal?.zona as { nombre?: string } | null)?.nombre ?? "Sin zona";

  // El API limita a 1000 filas por request; el maestro tiene >3000 veterinarias.
  // Paginamos para traerlas todas (necesario además para el modo offline del cadete).
  type VetRow = { id: string; codigo: string; nombre: string; telefono: string | null; direccion: string | null };
  const vets: VetRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("veterinarias")
      .select("id, codigo, nombre, telefono, direccion")
      .eq("activa", true)
      .order("nombre")
      .range(from, from + PAGE - 1);
    if (error || !data?.length) break;
    vets.push(...(data as VetRow[]));
    if (data.length < PAGE) break;
  }

  let pedidos: PedidoMobile[] = [];
  if (personalId) {
    const { data } = await supabase
      .from("pedidos_retiro")
      .select(`
        id, estado, urgente, detalle, materiales, created_at, fecha_limite,
        veterinaria:veterinaria_id(id, nombre, codigo)
      `)
      .eq("personal_asignado_id", personalId)
      .in("estado", ["asignado", "en_proceso"])
      .order("created_at", { ascending: true });

    pedidos = (data ?? []).map((p) => {
      const vet = p.veterinaria as { id?: string; nombre?: string; codigo?: string } | null;
      return {
        id: p.id,
        estado: p.estado,
        urgente: p.urgente,
        detalle: p.detalle,
        materiales: (p.materiales as string[] | null) ?? null,
        created_at: p.created_at,
        fecha_limite: p.fecha_limite,
        veterinaria_id: vet?.id ?? null,
        veterinaria_nombre: vet?.nombre ?? "Veterinaria",
        veterinaria_codigo: vet?.codigo ?? "",
      };
    });
  }

  // Retiros del día de este cadete — alimentan la solapa "Resumen".
  let retirosHoy: RetiroResumen[] = [];
  if (personalId) {
    const { data } = await supabase
      .from("retiros")
      .select(`
        id, veterinaria_id, veterinaria_texto_original, codigo_original, importe_declarado,
        cantidad_muestras, metodo_pago, comentarios, urgente, timestamp_carga,
        control_preanalitica:control_preanalitica(estado),
        control_cobranzas:control_cobranzas(estado)
      `)
      .eq("personal_id", personalId)
      .eq("fecha_operativa", todayISO())
      .eq("anulado", false)
      .neq("estado", "duplicado_sospechoso" as never)
      .order("timestamp_carga", { ascending: false });

    retirosHoy = (data ?? []).map((r) => {
      const pre = (Array.isArray(r.control_preanalitica) ? r.control_preanalitica[0] : r.control_preanalitica) as { estado?: string } | null;
      const cob = (Array.isArray(r.control_cobranzas) ? r.control_cobranzas[0] : r.control_cobranzas) as { estado?: string } | null;
      // Editable por el cadete solo mientras nadie lo procesó: pendiente (o sin
      // control) en preanalítica Y en cobranzas.
      const editable = (!pre || pre.estado === "pendiente") && (!cob || cob.estado === "pendiente");
      return {
        id: r.id,
        veterinaria: r.veterinaria_texto_original ?? "Veterinaria",
        codigo: r.codigo_original ?? "",
        importe: Number(r.importe_declarado ?? 0),
        muestras: Number(r.cantidad_muestras ?? 0),
        veterinariaId: r.veterinaria_id ?? null,
        metodoPago: r.metodo_pago ?? null,
        comentarios: r.comentarios ?? null,
        urgente: !!r.urgente,
        editable,
      };
    });
  }

  // Gastos de la caja abierta de hoy (sin rendir todavía) — para mostrarle al
  // cadete cuánto efectivo debería tener en la mano (ingreso en efectivo menos
  // estos gastos), sin que tenga que hacer la cuenta a mano.
  let totalGastosHoy = 0;
  if (personalId) {
    const { data } = await supabase
      .from("gastos")
      .select("monto")
      .eq("personal_id", personalId)
      .eq("fecha_operativa", todayISO())
      .is("rendicion_id", null);
    totalGastosHoy = (data ?? []).reduce((s, g) => s + Number(g.monto ?? 0), 0);
  }

  return (
    <MobileHome
      nombre={profile?.nombre ?? personal?.nombre ?? "Personal"}
      zonaNombre={zonaNombre}
      personalId={personalId}
      profileId={user.id}
      veterinarias={vets ?? []}
      pedidos={pedidos}
      retirosHoy={retirosHoy}
      totalGastosHoy={totalGastosHoy}
    />
  );
}

export interface RetiroResumen {
  id: string;
  veterinaria: string;
  codigo: string;
  importe: number;
  muestras: number;
  // Presentes solo para los retiros del servidor (no para los offline sin sync).
  veterinariaId?: string | null;
  metodoPago?: string | null;
  comentarios?: string | null;
  urgente?: boolean;
  editable?: boolean;
}

export interface PedidoMobile {
  id: string;
  estado: string;
  urgente: boolean;
  detalle: string | null;
  materiales: string[] | null;
  created_at: string;
  fecha_limite: string;
  veterinaria_id: string | null;
  veterinaria_nombre: string;
  veterinaria_codigo: string;
}
