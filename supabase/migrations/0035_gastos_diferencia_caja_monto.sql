-- ============================================================
-- 0035 — Permitir monto negativo solo para diferencia de caja
-- ============================================================
-- El resto de los gastos sigue sin poder cargarse en negativo. Una
-- "diferencia de caja" cuando SOBRA efectivo se guarda con monto negativo
-- (resta de total_gastos en vez de sumar), así el cálculo de "efectivo
-- esperado" (total_efectivo - total_gastos) ya la tiene en cuenta en todos
-- lados sin tener que tocar esas fórmulas (ControlCaja, /api/caja/validar).
alter table gastos drop constraint if exists gastos_monto_check;
alter table gastos add constraint gastos_monto_check check (monto >= 0 or tipo = 'diferencia_caja');
