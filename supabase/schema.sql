-- ============================================================
-- DIAGNOTEST — Schema SQL
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";

-- ── ENUMS ──────────────────────────────────────────────────
create type user_role as enum (
  'personal_logistica', 'jefe_logistica', 'preanalitica',
  'cobranzas', 'dueno', 'super_admin', 'carga'
);
create type tipo_personal as enum ('fijo', 'reemplazo', 'ventanilla');
create type tipo_retiro as enum ('veterinaria', 'ventanilla', 'reemplazo', 'otro');
create type metodo_pago as enum ('efectivo', 'transferencia', 'mercado_pago');
create type estado_retiro as enum (
  'registrado', 'en_proceso', 'controlado', 'finalizado',
  'anulado', 'duplicado_sospechoso'
);
create type estado_preanalitica as enum ('pendiente', 'ok', 'observado', 'rechazado');
create type estado_cobranzas as enum ('pendiente', 'adjudicado', 'diferencia', 'no_corresponde');
create type estado_pedido as enum ('asignado', 'en_proceso', 'resuelto', 'vencido', 'cancelado');
create type tipo_gasto as enum ('gasto', 'retiro_dinero');
create type estado_gasto as enum ('pendiente', 'autorizado', 'observado', 'rechazado');

-- ── PROFILES ───────────────────────────────────────────────
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null,
  email       text not null unique,
  rol         user_role not null default 'personal_logistica',
  activo      boolean not null default true,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nombre, email, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data->>'rol')::user_role, 'personal_logistica')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ── ZONAS ──────────────────────────────────────────────────
create table zonas (
  id          uuid primary key default uuid_generate_v4(),
  nombre      text not null unique,
  descripcion text,
  activa      boolean not null default true
);

-- ── PERSONAL ───────────────────────────────────────────────
create table personal (
  id           uuid primary key default uuid_generate_v4(),
  profile_id   uuid references profiles(id) on delete set null,
  nombre       text not null,
  zona_base_id uuid references zonas(id) on delete set null,
  tipo         tipo_personal not null default 'fijo',
  activo       boolean not null default true,
  observaciones text
);

-- ── VETERINARIAS ───────────────────────────────────────────
create table veterinarias (
  id                    uuid primary key default uuid_generate_v4(),
  codigo                text not null unique,
  nombre                text not null,
  direccion             text,
  zona_id               uuid references zonas(id) on delete set null,
  condicion_facturacion text,
  activa                boolean not null default true,
  es_fija               boolean not null default false,
  observaciones         text
);

-- ── RETIROS ────────────────────────────────────────────────
create table retiros (
  id                        uuid primary key default uuid_generate_v4(),
  timestamp_carga           timestamptz not null default now(),
  fecha_operativa           date not null,
  personal_id               uuid not null references personal(id),
  veterinaria_id            uuid references veterinarias(id) on delete set null,
  veterinaria_texto_original text not null,
  codigo_original           text,
  cantidad_muestras         integer not null default 0 check (cantidad_muestras >= 0),
  importe_declarado         numeric(12,2) not null default 0 check (importe_declarado >= 0),
  metodo_pago               metodo_pago not null default 'efectivo',
  comentarios               text,
  tipo                      tipo_retiro not null default 'veterinaria',
  urgente                   boolean not null default false,
  estado                    estado_retiro not null default 'registrado',
  latitud                   double precision,
  longitud                  double precision,
  sincronizado              boolean not null default true,
  pedido_id                 uuid,
  created_by                uuid not null references profiles(id),
  anulado                   boolean not null default false,
  segunda_visita            boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index idx_retiros_personal on retiros(personal_id);
create index idx_retiros_fecha on retiros(fecha_operativa);
create index idx_retiros_estado on retiros(estado);
create index idx_retiros_anulado on retiros(anulado);

-- ── CONTROL PREANALÍTICA ───────────────────────────────────
create table control_preanalitica (
  id             uuid primary key default uuid_generate_v4(),
  retiro_id      uuid not null unique references retiros(id) on delete cascade,
  estado         estado_preanalitica not null default 'pendiente',
  control_1      text,
  control_2      text,
  urgente        boolean not null default false,
  detalle        text,
  detalle_2      text,
  responsable_id uuid references profiles(id) on delete set null,
  responsable_1  text,
  responsable_2  text,
  cancelado        boolean not null default false,
  cancelado_motivo text,
  cancelado_por    uuid references profiles(id) on delete set null,
  cancelado_at     timestamptz,
  comentario       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── CONTROL COBRANZAS ──────────────────────────────────────
create table control_cobranzas (
  id               uuid primary key default uuid_generate_v4(),
  retiro_id        uuid not null unique references retiros(id) on delete cascade,
  estado           estado_cobranzas not null default 'pendiente',
  importe_declarado numeric(12,2) not null default 0,
  importe_validado  numeric(12,2),
  diferencia        numeric(12,2),
  detalle           text,
  medio_pago        text,
  responsable_id    uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Índices para filtrar las bandejas por estado sin scans lentos.
create index if not exists idx_control_cobranzas_estado on control_cobranzas(estado);
create index if not exists idx_control_preanalitica_estado on control_preanalitica(estado);

-- ── PEDIDOS DE RETIRO ──────────────────────────────────────
create table pedidos_retiro (
  id                    uuid primary key default uuid_generate_v4(),
  veterinaria_id        uuid not null references veterinarias(id),
  personal_asignado_id  uuid not null references personal(id),
  creado_por_id         uuid references profiles(id),
  estado                estado_pedido not null default 'asignado',
  urgente               boolean not null default false,
  es_automatico         boolean not null default false,
  detalle               text,
  materiales            text[],
  fecha_limite          timestamptz not null default (now() + interval '2 hours'),
  resuelto_en           timestamptz,
  retiro_id             uuid references retiros(id) on delete set null,
  reasignaciones        integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── GASTOS ─────────────────────────────────────────────────
create table gastos (
  id                  uuid primary key default uuid_generate_v4(),
  personal_id         uuid not null references personal(id),
  tipo                tipo_gasto not null default 'gasto',
  descripcion         text not null,
  monto               numeric(12,2) not null check (monto >= 0),
  fecha_operativa     date not null default current_date,
  comprobante_url     text,
  estado              estado_gasto not null default 'pendiente',
  autorizado_por      uuid references profiles(id) on delete set null,
  observacion_jefe    text,
  respuesta_personal  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── AUDITORÍA ──────────────────────────────────────────────
create table auditoria (
  id               uuid primary key default uuid_generate_v4(),
  entidad          text not null,
  entidad_id       text not null,
  accion           text not null,
  campo_modificado text,
  valor_anterior   text,
  valor_nuevo      text,
  usuario_id       uuid not null references profiles(id),
  fecha_hora       timestamptz not null default now()
);

create index idx_auditoria_entidad on auditoria(entidad, entidad_id);
create index idx_auditoria_fecha on auditoria(fecha_hora desc);

-- Responsable activo de preanalítica por etapa: los retiros nuevos heredan el
-- responsable activo de Control 1 al crear su control.
create table if not exists preanalitica_responsable_activo (
  stage text primary key check (stage in ('c1', 'c2')),
  responsable text,
  updated_at timestamptz not null default now()
);

-- Bolsas recibidas por cadete (carga manual de preanalítica). Dos valores por
-- día: un cadete puede hacer dos recorridos (V1 y V2).
create table if not exists bolsas_recibidas (
  id uuid primary key default uuid_generate_v4(),
  personal_id uuid not null references personal(id) on delete cascade,
  fecha date not null,
  bolsas_v1 integer,
  bolsas_v2 integer,
  updated_at timestamptz not null default now(),
  unique (personal_id, fecha)
);
create index if not exists idx_bolsas_recibidas_fecha on bolsas_recibidas(fecha);

-- ── TRIGGERS: auto-create controles al insertar retiro ─────
create or replace function create_controls_on_retiro()
returns trigger language plpgsql security definer as $$
declare
  resp_c1 text;
begin
  -- Solo se controla en preanalítica si hay muestras (0 muestras = sin control).
  if coalesce(new.cantidad_muestras, 0) > 0 then
    select responsable into resp_c1
      from preanalitica_responsable_activo where stage = 'c1';

    insert into control_preanalitica (retiro_id, urgente, responsable_1)
    values (new.id, new.urgente, resp_c1)
    on conflict (retiro_id) do nothing;
  end if;

  -- Cobranzas: solo si hay importe declarado (> $0).
  if coalesce(new.importe_declarado, 0) > 0 then
    insert into control_cobranzas (retiro_id, importe_declarado)
    values (new.id, new.importe_declarado)
    on conflict (retiro_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger on_retiro_insert
  after insert on retiros
  for each row execute procedure create_controls_on_retiro();

-- ── TRIGGER: detectar duplicados ───────────────────────────
create or replace function detect_duplicates()
returns trigger language plpgsql security definer as $$
declare
  dup_count integer;
begin
  -- Una segunda visita confirmada por el cadete nunca es duplicado.
  if new.segunda_visita then
    return new;
  end if;

  -- El match acota por día (fecha_operativa) y NO usa una ventana contra now()
  -- (rompía con cargas offline sincronizadas tarde). La veterinaria se compara
  -- por id del padrón, o por código suelto, o por nombre normalizado (para los
  -- retiros cargados por nombre sin id resuelto).
  select count(*) into dup_count
  from retiros r
  where r.personal_id = new.personal_id
    and r.fecha_operativa = new.fecha_operativa
    and r.cantidad_muestras = new.cantidad_muestras
    and abs(coalesce(r.importe_declarado, 0) - coalesce(new.importe_declarado, 0)) < 1
    and r.anulado = false
    and r.segunda_visita = false
    and r.id != new.id
    and (
      (new.veterinaria_id is not null and r.veterinaria_id = new.veterinaria_id)
      or (new.codigo_original is not null and r.codigo_original is not null
          and lower(btrim(r.codigo_original)) = lower(btrim(new.codigo_original)))
      or (coalesce(btrim(new.veterinaria_texto_original), '') <> ''
          and lower(btrim(coalesce(r.veterinaria_texto_original, '')))
            = lower(btrim(coalesce(new.veterinaria_texto_original, ''))))
    );

  if dup_count > 0 then
    update retiros set estado = 'duplicado_sospechoso' where id = new.id;
  end if;

  return new;
end;
$$;

create trigger on_retiro_dup_check
  after insert on retiros
  for each row execute procedure detect_duplicates();

-- ── TRIGGER: auto-vencer pedidos ───────────────────────────
create or replace function check_pedidos_vencidos()
returns void language plpgsql security definer as $$
begin
  update pedidos_retiro
  set estado = 'vencido', reasignaciones = reasignaciones + 1
  where estado in ('asignado', 'en_proceso')
    and fecha_limite < now();
end;
$$;

-- ── TRIGGER: updated_at ────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on profiles for each row execute procedure update_updated_at();
create trigger set_updated_at before update on retiros for each row execute procedure update_updated_at();
create trigger set_updated_at before update on control_preanalitica for each row execute procedure update_updated_at();
create trigger set_updated_at before update on control_cobranzas for each row execute procedure update_updated_at();
create trigger set_updated_at before update on pedidos_retiro for each row execute procedure update_updated_at();
create trigger set_updated_at before update on gastos for each row execute procedure update_updated_at();

-- ── RLS POLICIES ───────────────────────────────────────────
alter table profiles enable row level security;
alter table zonas enable row level security;
alter table personal enable row level security;
alter table veterinarias enable row level security;
alter table retiros enable row level security;
alter table control_preanalitica enable row level security;
alter table control_cobranzas enable row level security;
alter table pedidos_retiro enable row level security;
alter table gastos enable row level security;
alter table auditoria enable row level security;

-- Helper: get current user role
create or replace function get_my_role()
returns user_role language sql security definer stable as $$
  select rol from profiles where id = auth.uid()
$$;

create or replace function get_my_personal_id()
returns uuid language sql security definer stable as $$
  select id from personal where profile_id = auth.uid() limit 1
$$;

-- PROFILES policies
create policy "Users see own profile" on profiles for select using (id = auth.uid());
create policy "Admins see all profiles" on profiles for select using (get_my_role() in ('super_admin', 'jefe_logistica', 'dueno'));
create policy "Users update own profile" on profiles for update using (id = auth.uid());
create policy "Admins manage profiles" on profiles for all using (get_my_role() = 'super_admin');

-- ZONAS policies
create policy "All authenticated read zonas" on zonas for select using (auth.uid() is not null);
create policy "Admins manage zonas" on zonas for all using (get_my_role() = 'super_admin');

-- PERSONAL policies
create policy "All authenticated read personal" on personal for select using (auth.uid() is not null);
create policy "Admins manage personal" on personal for all using (get_my_role() = 'super_admin');

-- VETERINARIAS policies
create policy "All authenticated read vets" on veterinarias for select using (auth.uid() is not null);
create policy "Admins manage vets" on veterinarias for all using (get_my_role() = 'super_admin');

-- RETIROS policies
create policy "Personal see own retiros" on retiros for select
  using (get_my_role() = 'personal_logistica' and personal_id = get_my_personal_id());
create policy "Staff see all retiros" on retiros for select
  using (get_my_role() in ('jefe_logistica', 'preanalitica', 'cobranzas', 'dueno', 'super_admin'));
create policy "Personal insert retiros" on retiros for insert
  with check (get_my_role() in ('personal_logistica', 'jefe_logistica', 'super_admin'));
create policy "Jefe update retiros" on retiros for update
  using (get_my_role() in ('jefe_logistica', 'super_admin'));

-- CONTROL PREANALITICA policies
create policy "Pre read own" on control_preanalitica for select
  using (get_my_role() in ('preanalitica', 'jefe_logistica', 'dueno', 'super_admin'));
create policy "Personal see own pre" on control_preanalitica for select
  using (get_my_role() = 'personal_logistica' and retiro_id in (
    select id from retiros where personal_id = get_my_personal_id()
  ));
create policy "Pre update" on control_preanalitica for update
  using (get_my_role() in ('preanalitica', 'super_admin'));
create policy "Cob read pre" on control_preanalitica for select
  using (get_my_role() = 'cobranzas');
create policy "Carga read pre" on control_preanalitica for select
  using (get_my_role() = 'carga');

-- CONTROL COBRANZAS policies
create policy "Cob read" on control_cobranzas for select
  using (get_my_role() in ('cobranzas', 'jefe_logistica', 'dueno', 'super_admin'));
create policy "Personal see own cob" on control_cobranzas for select
  using (get_my_role() = 'personal_logistica' and retiro_id in (
    select id from retiros where personal_id = get_my_personal_id()
  ));
create policy "Cob update" on control_cobranzas for update
  using (get_my_role() in ('cobranzas', 'super_admin'));

-- PEDIDOS policies
create policy "Personal see own pedidos" on pedidos_retiro for select
  using (get_my_role() = 'personal_logistica' and personal_asignado_id = get_my_personal_id());
create policy "Staff see all pedidos" on pedidos_retiro for select
  using (get_my_role() in ('jefe_logistica', 'dueno', 'super_admin'));
create policy "Jefe create pedidos" on pedidos_retiro for insert
  with check (get_my_role() in ('jefe_logistica', 'super_admin'));
create policy "Jefe update pedidos" on pedidos_retiro for update
  using (get_my_role() in ('jefe_logistica', 'super_admin', 'personal_logistica'));

-- GASTOS policies
create policy "Personal see own gastos" on gastos for select
  using (get_my_role() = 'personal_logistica' and personal_id = get_my_personal_id());
create policy "Jefe see all gastos" on gastos for select
  using (get_my_role() in ('jefe_logistica', 'dueno', 'super_admin'));
create policy "Personal insert gastos" on gastos for insert
  with check (get_my_role() in ('personal_logistica', 'jefe_logistica', 'super_admin'));
create policy "Jefe update gastos" on gastos for update
  using (get_my_role() in ('jefe_logistica', 'dueno', 'super_admin'));

-- AUDITORIA policies
create policy "Admins see auditoria" on auditoria for select
  using (get_my_role() in ('jefe_logistica', 'dueno', 'super_admin'));
create policy "Insert auditoria" on auditoria for insert
  with check (auth.uid() is not null);
