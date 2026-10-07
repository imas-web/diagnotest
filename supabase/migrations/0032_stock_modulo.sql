-- ============================================================
-- 0032 — Módulo de Stock
-- ============================================================
-- Catálogo + estado de stock por artículo (código de Interpracsys), con dos
-- valores en paralelo por artículo:
--   - stock_sistema: lo que dice el último excel subido (lo que Interpracsys
--     cree que hay).
--   - stock_real: lo que alguien contó a mano en el depósito.
-- La diferencia entre ambos es justamente lo que Stock necesita ver. Cada
-- carga de excel y cada conteo manual además queda como un movimiento en
-- stock_movimientos, para tener histórico (útil a futuro para reportes de
-- tendencia) y auditoría de quién cargó qué.

create table if not exists stock_articulos (
  id                           uuid primary key default uuid_generate_v4(),
  codigo                       text not null unique,
  nombre                       text not null,
  categoria                    text,
  almacen                      text,
  stock_minimo                 numeric not null default 0,
  stock_sistema                numeric not null default 0,
  stock_sistema_actualizado_at timestamptz,
  stock_real                   numeric,
  stock_real_actualizado_at    timestamptz,
  stock_real_actualizado_por   uuid references profiles(id) on delete set null,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

create trigger set_updated_at before update on stock_articulos
  for each row execute procedure update_updated_at();

create type stock_tipo_movimiento as enum ('carga_excel', 'conteo_manual');

create table if not exists stock_movimientos (
  id             uuid primary key default uuid_generate_v4(),
  articulo_id    uuid not null references stock_articulos(id) on delete cascade,
  tipo           stock_tipo_movimiento not null,
  valor          numeric not null,
  stock_minimo   numeric,     -- snapshot del mínimo vigente (solo carga_excel)
  archivo_nombre text,        -- solo carga_excel
  comentario     text,        -- solo conteo_manual
  usuario_id     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_stock_movimientos_articulo on stock_movimientos(articulo_id, created_at desc);

alter table stock_articulos enable row level security;
alter table stock_movimientos enable row level security;

create policy "Stock ve catalogo" on stock_articulos for select
  using (get_my_role() in ('stock', 'dueno', 'super_admin'));
create policy "Stock administra catalogo" on stock_articulos for all
  using (get_my_role() in ('stock', 'dueno', 'super_admin'));

create policy "Stock ve movimientos" on stock_movimientos for select
  using (get_my_role() in ('stock', 'dueno', 'super_admin'));
create policy "Stock crea movimientos" on stock_movimientos for insert
  with check (get_my_role() in ('stock', 'dueno', 'super_admin'));
