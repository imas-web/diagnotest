-- Las políticas de chat_miembros, chat_conversaciones y chat_mensajes
-- resuelven "¿soy miembro de esta conversación?" haciendo un subquery
-- directo a chat_miembros. El problema es que la propia política de
-- SELECT de chat_miembros también hace ese mismo subquery sobre sí misma
-- para resolverse — Postgres lo detecta como referencia circular y tira
-- "infinite recursion detected in policy for relation chat_miembros" en
-- vez de resolverlo. Pasaba desapercibido en algunas lecturas (el select
-- de mensajes en el cliente no revisaba el error y mostraba la bandeja
-- vacía) pero rompía de forma visible al mandar un mensaje.
--
-- Se resuelve moviendo el chequeo a una función security definer: corre
-- con permisos propios y no vuelve a pasar por RLS al leer chat_miembros
-- adentro, así que no hay repregunta a la misma política.
create or replace function chat_es_miembro(p_conversacion_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from chat_miembros
    where conversacion_id = p_conversacion_id and profile_id = auth.uid()
  );
$$;

grant execute on function chat_es_miembro(uuid) to authenticated;

drop policy if exists "Ver conversaciones propias o general" on chat_conversaciones;
create policy "Ver conversaciones propias o general" on chat_conversaciones for select
  using (
    (tipo = 'general' and get_my_role() <> 'personal_logistica')
    or chat_es_miembro(id)
  );

drop policy if exists "Ver miembros de mis conversaciones" on chat_miembros;
create policy "Ver miembros de mis conversaciones" on chat_miembros for select
  using (
    chat_es_miembro(conversacion_id)
    or conversacion_id in (select id from chat_conversaciones where tipo = 'general')
  );

drop policy if exists "Ver mensajes de mis conversaciones" on chat_mensajes;
create policy "Ver mensajes de mis conversaciones" on chat_mensajes for select
  using (
    chat_es_miembro(conversacion_id)
    or conversacion_id in (select id from chat_conversaciones where tipo = 'general')
  );

drop policy if exists "Enviar mensajes a mis conversaciones" on chat_mensajes;
create policy "Enviar mensajes a mis conversaciones" on chat_mensajes for insert
  with check (
    remitente_id = auth.uid()
    and get_my_role() <> 'personal_logistica'
    and (
      chat_es_miembro(conversacion_id)
      or conversacion_id in (select id from chat_conversaciones where tipo = 'general')
    )
  );
