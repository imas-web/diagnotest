-- ============================================================
-- 0023 — Índices para acelerar las bandejas de control
-- ============================================================
-- Las bandejas de cobranzas y preanalítica filtran por estado sobre miles de
-- filas sin índice → scans lentos (la de cobranzas tardaba ~8s y se "tildaba").
-- Estos índices hacen que filtrar por estado sea inmediato.

create index if not exists idx_control_cobranzas_estado on control_cobranzas(estado);
create index if not exists idx_control_preanalitica_estado on control_preanalitica(estado);
