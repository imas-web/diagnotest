-- ============================================================
-- 0031 — Nuevo rol para el módulo de Stock
-- ============================================================
-- En su propia migración: un valor de enum recién agregado no se puede
-- usar (ej. en una policy) dentro de la misma transacción en que se crea
-- (limitación de Postgres), así que el módulo de Stock (0032) va aparte.
alter type user_role add value if not exists 'stock';
