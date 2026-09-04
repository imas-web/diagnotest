-- Vista de recaudación diaria por cadete (retiros no anulados), usada por el
-- reporte de /api/reportes/recaudacion-diaria (planilla de Sheets del dueño).
-- Solo accesible con service role: no se otorgan permisos a anon/authenticated,
-- así no queda expuesta vía la API pública de Supabase con la anon key.
create or replace view public.vista_recaudacion_diaria as
select
  r.fecha_operativa,
  p.nombre as cadete,
  sum(r.importe_declarado) as recaudado
from retiros r
join personal p on p.id = r.personal_id
where r.anulado = false
group by r.fecha_operativa, p.nombre;

revoke all on public.vista_recaudacion_diaria from anon, authenticated;
grant select on public.vista_recaudacion_diaria to service_role;
