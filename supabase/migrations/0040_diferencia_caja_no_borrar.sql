-- ============================================================
-- 0040 — No borrar la diferencia de caja vieja: marcarla desactualizada
-- ============================================================
-- La 0039 borraba la diferencia de caja del cadete si después se cargaba o
-- editaba un retiro suyo del mismo día. Pero el conteo físico que hizo el
-- cadete no cambia por eso — el dinero que tiene en la mano es el que es.
-- Lo que cambia es cuánto dice el sistema que debería tener, así que esa
-- declaración sigue siendo un dato real y no hay que perderlo; lo que hay
-- que hacer es dejar de usarlo para calcular el efectivo esperado (porque ya
-- no refleja los retiros actuales) y avisarle al cadete que tiene que volver
-- a confirmar — no borrarlo en silencio.

alter table gastos add column if not exists invalidada_en timestamptz;

create or replace function invalidar_diferencia_caja_por_retiro()
returns trigger language plpgsql security definer as $$
begin
  update gastos
  set invalidada_en = coalesce(invalidada_en, now())
  where tipo = 'diferencia_caja'
    and rendicion_id is null
    and invalidada_en is null
    and personal_id = new.personal_id
    and fecha_operativa = new.fecha_operativa;

  if tg_op = 'UPDATE'
     and (old.personal_id is distinct from new.personal_id
          or old.fecha_operativa is distinct from new.fecha_operativa) then
    update gastos
    set invalidada_en = coalesce(invalidada_en, now())
    where tipo = 'diferencia_caja'
      and rendicion_id is null
      and invalidada_en is null
      and personal_id = old.personal_id
      and fecha_operativa = old.fecha_operativa;
  end if;

  return new;
end;
$$;

-- Declarar una diferencia nueva sigue reemplazando (no sumando) cualquier
-- diferencia sin sellar previa del mismo cadete/día — sea que estuviera
-- vigente o ya desactualizada.
create or replace function reemplazar_diferencia_caja_anterior()
returns trigger language plpgsql security definer as $$
begin
  update gastos
  set invalidada_en = coalesce(invalidada_en, now())
  where tipo = 'diferencia_caja'
    and rendicion_id is null
    and invalidada_en is null
    and personal_id = new.personal_id
    and fecha_operativa = new.fecha_operativa
    and id <> new.id;
  return new;
end;
$$;
