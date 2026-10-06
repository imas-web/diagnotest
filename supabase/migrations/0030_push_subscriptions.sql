-- ============================================================
-- 0030 — Suscripciones de notificaciones push (Web Push / VAPID)
-- ============================================================
-- Guarda la suscripción push del navegador de cada cuenta (endpoint + claves
-- p256dh/auth) para poder avisar de un mensaje nuevo del chat aunque la
-- pestaña esté minimizada o "congelada" por el navegador — a diferencia del
-- aviso in-page (sonido/notificación local), esto lo entrega el sistema
-- operativo directamente al navegador, sin depender de que la página esté
-- despierta procesando JS.
create table if not exists push_subscriptions (
  id          uuid primary key default uuid_generate_v4(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_profile on push_subscriptions(profile_id);

alter table push_subscriptions enable row level security;

create policy "Ver mis suscripciones push" on push_subscriptions for select
  using (profile_id = auth.uid());
create policy "Crear mi suscripción push" on push_subscriptions for insert
  with check (profile_id = auth.uid());
create policy "Borrar mi suscripción push" on push_subscriptions for delete
  using (profile_id = auth.uid());
