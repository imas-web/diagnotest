-- Seguimiento del recibo generado en el SGE (Interpracsys) al adjudicar una
-- cobranza: evita tener que ir a buscarlo a mano y permite reintentar los que
-- fallaron (clave vencida, veterinaria sin código vinculado, etc).
alter table control_cobranzas
  add column if not exists recibo_sge_id bigint,
  add column if not exists recibo_sge_numero text,
  add column if not exists recibo_sge_estado text check (recibo_sge_estado in ('ok', 'error')),
  add column if not exists recibo_sge_error text,
  add column if not exists recibo_sge_actualizado_at timestamptz;
