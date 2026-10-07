import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { StockBandeja } from "@/components/stock/StockBandeja";
import { landingPathForRole } from "@/lib/utils/roles";

export const revalidate = 15;

const ROLES = ["stock", "dueno", "super_admin"];

export default async function StockPage() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await auth.from("profiles").select("rol").eq("id", user.id).single();
  if (!perfil || !ROLES.includes(perfil.rol)) redirect(landingPathForRole(perfil?.rol));

  const admin = createAdminClient();
  const { data: articulos } = await admin
    .from("stock_articulos")
    .select("*")
    .order("categoria", { ascending: true, nullsFirst: false })
    .order("nombre", { ascending: true });

  const lista = articulos ?? [];
  const enMinimo = lista.filter((a) => a.stock_sistema <= a.stock_minimo).length;
  const conDiferencia = lista.filter((a) => a.stock_real !== null && a.stock_real !== a.stock_sistema).length;
  const sinConteo = lista.filter((a) => a.stock_real === null).length;

  return (
    <div>
      <Topbar title="Stock" subtitle="Insumos de laboratorio — Interpracsys" />
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <StatCard label="Artículos" value={lista.length} />
          <StatCard label="En o por debajo del mínimo" value={enMinimo} accent="danger" />
          <StatCard label="Con diferencia vs. conteo real" value={conDiferencia} accent="warn" />
          <StatCard label="Sin conteo real cargado" value={sinConteo} />
        </div>

        <StockBandeja articulos={lista} />
      </div>
    </div>
  );
}
