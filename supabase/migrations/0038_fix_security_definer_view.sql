-- ============================================================
-- 0038 — Fix: veterinarias_fijas_estado esquivaba RLS (Security Definer View)
-- ============================================================
-- El Advisor de Supabase marcó esto CRITICAL. Una vista, por defecto, corre
-- con los permisos de quien la CREÓ (no de quien la consulta) — así, aunque
-- veterinarias/personal/zonas tienen RLS activado (confirmado: las 3 con
-- relrowsecurity = true), esta vista (otorgada a "authenticated" en la
-- migración 0022) dejaba leerla a cualquier usuario logueado de cualquier
-- rol, esquivando esas políticas.
--
-- Los únicos lugares que hoy la consultan con el cliente de sesión (no
-- admin) son pedidos/page.tsx (banner para jefe_logistica/dueno/super_admin)
-- y admin/veterinarias/page.tsx (jefe_logistica/super_admin, además de
-- consultar "veterinarias" directo) — por eso se agrega una política para
-- esos 3 roles en las tablas que usa la vista, sin tocar la política
-- existente de "carga".

create policy "Staff read vets" on veterinarias for select
  using (get_my_role() in ('jefe_logistica', 'dueno', 'super_admin'));

create policy "Staff read personal" on personal for select
  using (get_my_role() in ('jefe_logistica', 'dueno', 'super_admin'));

create policy "Staff read zonas" on zonas for select
  using (get_my_role() in ('jefe_logistica', 'dueno', 'super_admin'));

-- La vista ahora respeta el RLS de quien la consulta en vez de los permisos
-- de quien la creó — cierra el hueco que señaló el Advisor.
alter view veterinarias_fijas_estado set (security_invoker = true);
