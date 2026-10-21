-- ============================================================
-- 0039 — Consistencia de "Diferencia de caja" (sobra/falta)
-- ============================================================
-- Caso real: un cadete declaró su diferencia de caja del día y DESPUÉS logística
-- le avisó de un retiro que faltaba cargar; lo cargó tarde, pero la diferencia ya
-- declarada quedó vieja — nadie la invalida, y "efectivo esperado" (que la usa)
-- terminó siendo un número que ya no corresponde a los retiros reales del día.
-- Dependía de que el cadete se acordara de avisar a mano por fuera del sistema.
--
-- Dos reglas para que esto no dependa de la memoria de nadie:
-- 1) Cargar o editar un retiro de un cadete/día invalida (borra) la diferencia
--    de caja sin sellar que ya tuviera declarada ese día — lo obliga a volver a
--    declararla con los números al día.
-- 2) Declarar una diferencia de caja nueva reemplaza (no suma) cualquier
--    diferencia sin sellar previa del mismo cadete/día.
-- Ninguna de las dos toca diferencias ya selladas en una rendición
-- (rendicion_id no nulo): eso es historial cerrado, no se modifica.

create or replace function invalidar_diferencia_caja_por_retiro()
returns trigger language plpgsql security definer as $$
begin
  delete from gastos
  where tipo = 'diferencia_caja'
    and rendicion_id is null
    and personal_id = new.personal_id
    and fecha_operativa = new.fecha_operativa;

  -- Si el retiro cambió de cadete o de día, también invalida la diferencia
  -- del cadete/día al que pertenecía antes (ya no la representa).
  if tg_op = 'UPDATE'
     and (old.personal_id is distinct from new.personal_id
          or old.fecha_operativa is distinct from new.fecha_operativa) then
    delete from gastos
    where tipo = 'diferencia_caja'
      and rendicion_id is null
      and personal_id = old.personal_id
      and fecha_operativa = old.fecha_operativa;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_invalidar_diferencia_caja on retiros;
create trigger trg_invalidar_diferencia_caja
  after insert or update of importe_declarado, metodo_pago, anulado, fecha_operativa, personal_id
  on retiros
  for each row
  execute function invalidar_diferencia_caja_por_retiro();

create or replace function reemplazar_diferencia_caja_anterior()
returns trigger language plpgsql security definer as $$
begin
  delete from gastos
  where tipo = 'diferencia_caja'
    and rendicion_id is null
    and personal_id = new.personal_id
    and fecha_operativa = new.fecha_operativa
    and id <> new.id;
  return new;
end;
$$;

drop trigger if exists trg_reemplazar_diferencia_caja on gastos;
create trigger trg_reemplazar_diferencia_caja
  before insert on gastos
  for each row
  when (new.tipo = 'diferencia_caja')
  execute function reemplazar_diferencia_caja_anterior();
