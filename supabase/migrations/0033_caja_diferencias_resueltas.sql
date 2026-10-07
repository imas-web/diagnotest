-- ============================================================
-- 0033 — Marcar diferencias de caja como resueltas
-- ============================================================
-- Las rendiciones con estado 'diferencia' quedaban registradas para
-- siempre sin forma de distinguir "ya lo resolví" (descontado al cadete,
-- corregido el importe de una veterinaria, etc.) de lo que todavía falta
-- revisar. Se agrega el flag + una nota propia de la resolución (separada
-- de "observacion", que guarda el motivo original de la diferencia).

alter table rendiciones_caja
  add column if not exists resuelta boolean not null default false,
  add column if not exists resuelta_en timestamptz,
  add column if not exists resuelta_por uuid references profiles(id) on delete set null,
  add column if not exists nota_resolucion text;
