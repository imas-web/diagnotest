-- ============================================================
-- 0025 — Módulo de chat interno (DiagnoLis)
-- ============================================================
-- Modelo unificado: una "conversación" es un DM (2 miembros) o un grupo
-- (N miembros, ej. canal de sector). Los mensajes siempre cuelgan de una
-- conversación; no hay una tabla separada para DMs vs grupos.
--
-- El canal "General" es especial: no tiene filas en chat_miembros, es
-- visible para cualquier profile activo cuyo rol no sea personal_logistica
-- (los cadetes tienen su propia UI mobile y no están en el roster de esta
-- primera etapa). Los 4 canales de sector sí tienen membresía explícita,
-- porque agrupan gente de sectores que no corresponden a ningún rol
-- existente (ej. Administración, Citología).

-- Nuevo rol para gente que solo necesita el chat, sin acceso operativo.
alter type user_role add value if not exists 'chat';

create type chat_tipo_conversacion as enum ('dm', 'grupo', 'general');

create table if not exists chat_conversaciones (
  id          uuid primary key default uuid_generate_v4(),
  tipo        chat_tipo_conversacion not null,
  nombre      text,
  -- Para DMs: clave estable "menor_id|mayor_id" que evita crear dos
  -- conversaciones distintas entre el mismo par de usuarios.
  dm_clave    text unique,
  created_at  timestamptz not null default now()
);

create table if not exists chat_miembros (
  conversacion_id uuid not null references chat_conversaciones(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  primary key (conversacion_id, profile_id)
);

create table if not exists chat_mensajes (
  id              uuid primary key default uuid_generate_v4(),
  conversacion_id uuid not null references chat_conversaciones(id) on delete cascade,
  remitente_id    uuid not null references profiles(id) on delete cascade,
  contenido       text,
  adjunto_url     text,
  adjunto_tipo    text,
  adjunto_nombre  text,
  created_at      timestamptz not null default now(),
  check (coalesce(contenido, '') <> '' or adjunto_url is not null)
);

create index if not exists idx_chat_mensajes_conversacion on chat_mensajes(conversacion_id, created_at);
create index if not exists idx_chat_miembros_profile on chat_miembros(profile_id);

-- El canal General se crea una sola vez, sin membresía explícita.
insert into chat_conversaciones (tipo, nombre)
select 'general', 'General'
where not exists (select 1 from chat_conversaciones where tipo = 'general');

-- Realtime: para que los mensajes nuevos lleguen sin refrescar.
alter publication supabase_realtime add table chat_mensajes;

-- ── RLS ──────────────────────────────────────────────────────
alter table chat_conversaciones enable row level security;
alter table chat_miembros enable row level security;
alter table chat_mensajes enable row level security;

-- Conversaciones: General es visible para cualquiera que no sea cadete de
-- logística; DM/grupo solo para sus miembros.
create policy "Ver conversaciones propias o general" on chat_conversaciones for select
  using (
    (tipo = 'general' and get_my_role() <> 'personal_logistica')
    or id in (select conversacion_id from chat_miembros where profile_id = auth.uid())
  );

create policy "Crear conversaciones" on chat_conversaciones for insert
  with check (auth.uid() is not null and get_my_role() <> 'personal_logistica');

-- Miembros: se puede ver la lista de miembros de una conversación propia,
-- y sumarse a conversaciones a las que ya se puede acceder (crear DM propio).
create policy "Ver miembros de mis conversaciones" on chat_miembros for select
  using (
    conversacion_id in (select conversacion_id from chat_miembros where profile_id = auth.uid())
    or conversacion_id in (select id from chat_conversaciones where tipo = 'general')
  );
-- Cualquier usuario no-cadete puede sumar filas de membresía (a sí mismo o a
-- la otra parte de un DM que está creando); el chat es abierto entre todos.
create policy "Sumar miembros" on chat_miembros for insert
  with check (auth.uid() is not null and get_my_role() <> 'personal_logistica');
create policy "Marcar leído" on chat_miembros for update
  using (profile_id = auth.uid());

-- Mensajes: solo de conversaciones donde el usuario es miembro (o General).
create policy "Ver mensajes de mis conversaciones" on chat_mensajes for select
  using (
    conversacion_id in (select conversacion_id from chat_miembros where profile_id = auth.uid())
    or conversacion_id in (select id from chat_conversaciones where tipo = 'general')
  );
create policy "Enviar mensajes a mis conversaciones" on chat_mensajes for insert
  with check (
    remitente_id = auth.uid()
    and get_my_role() <> 'personal_logistica'
    and (
      conversacion_id in (select conversacion_id from chat_miembros where profile_id = auth.uid())
      or conversacion_id in (select id from chat_conversaciones where tipo = 'general')
    )
  );

-- ── STORAGE: adjuntos del chat ──────────────────────────────
insert into storage.buckets (id, name, public)
values ('chat-adjuntos', 'chat-adjuntos', true)
on conflict (id) do nothing;

create policy "chat_adjuntos_public_read"
  on storage.objects for select
  using (bucket_id = 'chat-adjuntos');

create policy "chat_adjuntos_auth_insert"
  on storage.objects for insert
  with check (bucket_id = 'chat-adjuntos' and auth.uid() is not null);
