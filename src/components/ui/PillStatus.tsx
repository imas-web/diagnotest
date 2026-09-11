import { cn } from "@/lib/utils/format";

type PillVariant =
  | "ok"
  | "pendiente"
  | "observado"
  | "registrado"
  | "urgente"
  | "vencido"
  | "asignado"
  | "resuelto"
  | "autorizado"
  | "diferencia"
  | "grey"
  | "purple"
  | "sync"
  | "nosync";

const VARIANTS: Record<PillVariant, string> = {
  ok: "bg-g50 text-g700",
  pendiente: "bg-amber-bg text-amber-text",
  observado: "bg-red-50 text-red-700",
  registrado: "bg-blue-50 text-blue-700",
  urgente: "bg-red-100 text-red-700",
  vencido: "bg-red-100 text-red-700",
  asignado: "bg-blue-50 text-blue-700",
  resuelto: "bg-g50 text-g700",
  autorizado: "bg-g50 text-g700",
  diferencia: "bg-red-50 text-red-700",
  grey: "bg-gy100 text-gy600",
  purple: "bg-purple-50 text-purple-700",
  sync: "bg-g50 text-g700",
  nosync: "bg-orange-50 text-orange-700",
};

const LABELS: Record<PillVariant, string> = {
  ok: "OK",
  pendiente: "Pendiente",
  observado: "Observado",
  registrado: "Registrado",
  urgente: "URGENTE",
  vencido: "Vencido",
  asignado: "Asignado",
  resuelto: "Resuelto",
  autorizado: "Autorizado",
  diferencia: "Diferencia",
  grey: "—",
  purple: "—",
  sync: "Sincronizado",
  nosync: "Pendiente sync",
};

interface Props {
  variant: PillVariant;
  label?: string;
  className?: string;
}

export function PillStatus({ variant, label, className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap",
        VARIANTS[variant],
        className
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
      {label ?? LABELS[variant]}
    </span>
  );
}

export function RoleBadge({ rol }: { rol: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    personal_logistica: { label: "Personal logística", cls: "bg-blue-50 text-blue-700" },
    jefe_logistica: { label: "Jefe logística", cls: "bg-purple-50 text-purple-700" },
    preanalitica: { label: "Preanalítica", cls: "bg-amber-bg text-amber-text" },
    cobranzas: { label: "Cobranzas", cls: "bg-gy100 text-gy600" },
    carga: { label: "Carga", cls: "bg-blue-50 text-blue-700" },
    dueno: { label: "Dueño", cls: "bg-g50 text-g700" },
    super_admin: { label: "Super Admin", cls: "bg-red-50 text-red-700" },
    chat: { label: "Solo chat", cls: "bg-gy100 text-gy500" },
  };
  const r = map[rol] ?? { label: rol, cls: "bg-gy100 text-gy600" };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-semibold", r.cls)}>
      {r.label}
    </span>
  );
}
