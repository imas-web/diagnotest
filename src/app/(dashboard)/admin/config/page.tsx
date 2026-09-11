import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Topbar } from "@/components/layout/Topbar";
import { UsuariosManager, type UsuarioRow, type ZonaOption } from "@/components/admin/UsuariosManager";

export default async function ConfigPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
  if (me?.rol !== "super_admin") redirect("/dashboard");

  const [{ data: profiles }, { data: zonas }, { data: personal }] = await Promise.all([
    supabase.from("profiles").select("id, nombre, email, rol, activo").order("nombre"),
    supabase.from("zonas").select("id, nombre").eq("activa", true).order("nombre"),
    supabase.from("personal").select("profile_id, zona_base_id, tipo"),
  ]);

  // Mapear zona/tipo de la ficha de Personal a cada usuario cadete.
  const personalByProfile = new Map(
    (personal ?? []).filter((p) => p.profile_id).map((p) => [p.profile_id as string, p])
  );
  const usuarios: UsuarioRow[] = (profiles ?? []).map((p) => {
    const ficha = personalByProfile.get(p.id);
    return {
      id: p.id, nombre: p.nombre, email: p.email, rol: p.rol, activo: p.activo,
      zona_base_id: (ficha?.zona_base_id as string | null) ?? null,
      tipo: (ficha?.tipo as string | null) ?? null,
    };
  });

  return (
    <div>
      <Topbar title="Configuración" subtitle="DiagnoLis" />
      <div className="p-6">
        <UsuariosManager usuarios={usuarios} zonas={(zonas ?? []) as ZonaOption[]} />
      </div>
    </div>
  );
}
