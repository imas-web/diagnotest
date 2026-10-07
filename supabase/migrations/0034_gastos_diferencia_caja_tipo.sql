-- ============================================================
-- 0034 — Nuevo tipo de gasto: diferencia de caja
-- ============================================================
-- El cadete cuenta su efectivo y, si no coincide con lo que debería tener
-- (ingreso en efectivo menos gastos), puede anotar esa diferencia como un
-- gasto más — en su propia migración porque un valor de enum recién
-- agregado no se puede usar (ej. en la migración 0035) en la misma
-- transacción en que se crea (limitación de Postgres).
alter type tipo_gasto add value if not exists 'diferencia_caja';
