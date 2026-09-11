"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils/format";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types";
import { initials } from "@/lib/utils/format";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: number;
  badgeClass?: string;
}

function getNavItems(rol: string): NavItem[] {
  switch (rol) {
    case "personal_logistica":
      return [
        { href: "/retiros/nuevo", label: "Nuevo retiro", icon: "ti-circle-plus" },
        { href: "/retiros", label: "Mis retiros", icon: "ti-list" },
        { href: "/pedidos", label: "Pedidos asignados", icon: "ti-map-pin" },
        { href: "/gastos", label: "Gastos y retiros", icon: "ti-receipt" },
      ];
    case "jefe_logistica":
      return [
        { href: "/pedidos", label: "Pedidos de retiro", icon: "ti-map-pin", badgeClass: "blue" },
        { href: "/retiros", label: "Todos los retiros", icon: "ti-table" },
        { href: "/retiros/por-personal", label: "Por personal", icon: "ti-user" },
        { href: "/admin/veterinarias", label: "Veterinarias", icon: "ti-building-hospital" },
        { href: "/retiros/duplicados", label: "Duplicados", icon: "ti-copy", badgeClass: "amber" },
        { href: "/gastos/autorizar", label: "Gastos a autorizar", icon: "ti-cash", badgeClass: "purple" },
        { href: "/chat", label: "Chat", icon: "ti-message-circle" },
      ];
    case "preanalitica":
      return [
        { href: "/preanalitica", label: "Bandeja", icon: "ti-inbox" },
        { href: "/preanalitica/controlados", label: "Controlados", icon: "ti-check" },
        { href: "/preanalitica/observados", label: "Observados", icon: "ti-alert-circle" },
        { href: "/resumen", label: "Resumen", icon: "ti-report-analytics" },
        { href: "/retiros/duplicados", label: "Duplicados", icon: "ti-copy", badgeClass: "amber" },
        { href: "/chat", label: "Chat", icon: "ti-message-circle" },
      ];
    case "cobranzas":
      return [
        { href: "/cobranzas", label: "Pendientes", icon: "ti-inbox", badgeClass: "amber" },
        { href: "/cobranzas/validados", label: "Validados", icon: "ti-circle-check" },
        { href: "/cobranzas/diferencias", label: "Diferencias", icon: "ti-alert-triangle", badgeClass: "amber" },
        { href: "/chat", label: "Chat", icon: "ti-message-circle" },
      ];
    case "carga":
      return [
        { href: "/carga", label: "Controlados", icon: "ti-clipboard-check" },
        { href: "/chat", label: "Chat", icon: "ti-message-circle" },
      ];
    case "dueno":
      return [
        { href: "/dashboard", label: "Dashboard", icon: "ti-chart-bar" },
        { href: "/caja", label: "Control de caja", icon: "ti-cash-register" },
        { href: "/retiros", label: "Todos los retiros", icon: "ti-table" },
        { href: "/gastos/autorizar", label: "Gastos", icon: "ti-cash" },
        { href: "/chat", label: "Chat", icon: "ti-message-circle" },
      ];
    case "super_admin":
      return [
        { href: "/dashboard", label: "Dashboard", icon: "ti-chart-bar" },
        { href: "/caja", label: "Control de caja", icon: "ti-cash-register" },
        { href: "/resumen", label: "Resumen", icon: "ti-report-analytics" },
        { href: "/preanalitica/observados", label: "Observados", icon: "ti-alert-circle" },
        { href: "/pedidos", label: "Pedidos de retiro", icon: "ti-map-pin", badgeClass: "blue" },
        { href: "/retiros", label: "Todos los retiros", icon: "ti-table" },
        { href: "/admin/personal", label: "Personal", icon: "ti-users" },
        { href: "/admin/veterinarias", label: "Veterinarias", icon: "ti-building-hospital" },
        { href: "/admin/zonas", label: "Zonas", icon: "ti-map" },
        { href: "/gastos/autorizar", label: "Gastos", icon: "ti-cash", badgeClass: "purple" },
        { href: "/cancelados", label: "Cancelados / Anulados", icon: "ti-ban", badgeClass: "default" },
        { href: "/admin/auditoria", label: "Auditoría", icon: "ti-history" },
        { href: "/chat", label: "Chat", icon: "ti-message-circle" },
        { href: "/admin/config", label: "Configuración", icon: "ti-settings" },
      ];
    case "chat":
      return [
        { href: "/chat", label: "Chat", icon: "ti-message-circle" },
      ];
    default:
      return [];
  }
}

const badgeStyles: Record<string, string> = {
  default: "bg-red-500 text-white",
  blue: "bg-blue-500 text-white",
  amber: "bg-amber text-amber-text",
  purple: "bg-purple-500 text-white",
};

interface Props {
  profile: Profile;
  onNavigate?: () => void;
}

export function Sidebar({ profile, onNavigate }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const navItems = getNavItems(profile.rol);

  // Badges reales (en vez de números fijos). Se recalculan al navegar, al
  // volver a la pestaña y cuando una acción dispara el evento "badges:refresh".
  const [dupCount, setDupCount] = useState(0);
  const [pedidosCount, setPedidosCount] = useState(0);
  const [gastosCount, setGastosCount] = useState(0);
  const [cancelCount, setCancelCount] = useState(0);
  const [cobPendCount, setCobPendCount] = useState(0);
  const [cobDifCount, setCobDifCount] = useState(0);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);

  const rol = profile.rol;
  const refreshBadges = useCallback(() => {
    const supabase = createClient();

    // Duplicados: retiros marcados como sospechosos (jefe / preanalítica).
    if (["jefe_logistica", "preanalitica", "super_admin"].includes(rol)) {
      supabase
        .from("retiros")
        .select("id", { count: "exact", head: true })
        .eq("estado", "duplicado_sospechoso")
        .eq("anulado", false)
        .then(({ count }) => setDupCount(count ?? 0));
    }

    // Pedidos abiertos: asignado / en proceso / vencido.
    if (["jefe_logistica", "super_admin"].includes(rol)) {
      supabase
        .from("pedidos_retiro")
        .select("id", { count: "exact", head: true })
        .in("estado", ["asignado", "en_proceso", "vencido"])
        .then(({ count }) => setPedidosCount(count ?? 0));
    }

    // Gastos pendientes de autorizar.
    if (["jefe_logistica", "super_admin", "dueno"].includes(rol)) {
      supabase
        .from("gastos")
        .select("id", { count: "exact", head: true })
        .eq("estado", "pendiente")
        .then(({ count }) => setGastosCount(count ?? 0));
    }

    // Cancelados / anulados por preanalítica (solo super_admin lo ve en el menú).
    if (rol === "super_admin") {
      supabase
        .from("control_preanalitica")
        .select("id", { count: "exact", head: true })
        .or("cancelado.eq.true,etiquetas.cs.{Anula}")
        .then(({ count }) => setCancelCount(count ?? 0));
    }

    // Pendientes y diferencias de cobranzas (conteos reales).
    if (["cobranzas", "super_admin", "dueno"].includes(rol)) {
      supabase
        .from("control_cobranzas")
        .select("id, retiro:retiro_id!inner(anulado, estado)", { count: "exact", head: true })
        .eq("estado", "pendiente")
        .eq("retiro.anulado", false)
        .neq("retiro.estado", "duplicado_sospechoso")
        .then(({ count }) => setCobPendCount(count ?? 0));
      supabase
        .from("control_cobranzas")
        .select("id", { count: "exact", head: true })
        .eq("estado", "diferencia")
        .then(({ count }) => setCobDifCount(count ?? 0));
    }

    // Chat sin leer: conversaciones propias cuyo último mensaje es más
    // nuevo que mi last_read_at y no lo mandé yo.
    if (rol !== "personal_logistica") {
      supabase
        .from("chat_miembros")
        .select("conversacion_id, last_read_at")
        .eq("profile_id", profile.id)
        .then(async ({ data: miembros }) => {
          if (!miembros?.length) { setChatUnreadCount(0); return; }
          const ids = miembros.map((m) => m.conversacion_id);
          const { data: mensajes } = await supabase
            .from("chat_mensajes")
            .select("conversacion_id, created_at, remitente_id")
            .in("conversacion_id", ids)
            .order("created_at", { ascending: false })
            .limit(500);
          const ultimoPorConversacion = new Map<string, { created_at: string; remitente_id: string }>();
          for (const m of mensajes ?? []) {
            if (!ultimoPorConversacion.has(m.conversacion_id)) ultimoPorConversacion.set(m.conversacion_id, m);
          }
          const noLeidas = miembros.filter((m) => {
            const ultimo = ultimoPorConversacion.get(m.conversacion_id);
            return ultimo && ultimo.remitente_id !== profile.id && ultimo.created_at > m.last_read_at;
          });
          setChatUnreadCount(noLeidas.length);
        });
    }
  }, [rol, profile.id]);

  useEffect(() => {
    refreshBadges();
    const onFocus = () => refreshBadges();
    window.addEventListener("badges:refresh", refreshBadges);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("badges:refresh", refreshBadges);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshBadges, pathname]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="w-56 bg-g800 flex flex-col shrink-0 z-20" style={{ boxShadow: "2px 0 20px rgba(0,0,0,.15)" }}>
      {/* Logo */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-center">
        <div className="bg-white rounded-xl px-3 py-2 shadow-md">
          <Image src="/logo.png" alt="Diagnotest" width={148} height={48} className="object-contain" priority />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 scrollbar-hide">
        <div className="px-4 py-3 text-[9px] uppercase tracking-widest text-white/30 font-semibold">
          Panel
        </div>
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const bc = badgeStyles[item.badgeClass ?? "default"];
          // Badges con conteo real; si es 0 no muestran nada.
          const badge =
            item.href === "/retiros/duplicados" ? (dupCount || undefined)
            : item.href === "/pedidos" ? (pedidosCount || undefined)
            : item.href === "/gastos/autorizar" ? (gastosCount || undefined)
            : item.href === "/cancelados" ? (cancelCount || undefined)
            : item.href === "/cobranzas" ? (cobPendCount || undefined)
            : item.href === "/cobranzas/diferencias" ? (cobDifCount || undefined)
            : item.href === "/chat" ? (chatUnreadCount || undefined)
            : item.badge;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 px-4 py-[9px] text-[13px] border-l-[3px] transition-all",
                active
                  ? "bg-white/13 text-white border-l-amber font-medium"
                  : "text-white/65 border-l-transparent hover:bg-white/7 hover:text-white/90"
              )}
            >
              <i className={cn("ti text-[17px] shrink-0", item.icon)} />
              {item.label}
              {badge ? (
                <span className={cn("ml-auto text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-tight", bc)}>
                  {badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-3.5 py-3 border-t border-white/10">
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="w-8 h-8 rounded-full bg-g500 flex items-center justify-center text-[11px] font-bold text-white shrink-0 border-2 border-white/20">
            {initials(profile.nombre)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-white truncate">{profile.nombre}</div>
            <div className="text-[10px] text-white/40 mt-0.5 truncate">{profile.rol.replace(/_/g, " ")}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-[6px] bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-[11px] font-medium transition-all"
        >
          <i className="ti ti-logout text-[13px]" /> Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
