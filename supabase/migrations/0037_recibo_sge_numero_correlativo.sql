-- Numeración correlativa para el "numero" que se manda al SGE al generar el
-- recibo (antes era un hash sin orden). Formato 0002-00000001, 0002-00000002…
-- Se asigna una sola vez por cobranza (al primer intento) y se reutiliza en
-- los reintentos, para no duplicar el recibo allá.
create sequence if not exists recibo_sge_correlativo_seq start 1;

create or replace function siguiente_recibo_sge_numero()
returns text language sql as $$
  select '0002-' || lpad(nextval('recibo_sge_correlativo_seq')::text, 8, '0')
$$;
