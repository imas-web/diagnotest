-- 0027 agregó "conversacion_id in (select id from chat_conversaciones where
-- tipo in ('general','grupo'))" a la política de insert de chat_mensajes,
-- pero esa subconsulta corre bajo las mismas reglas de permisos de
-- chat_conversaciones — que para un grupo solo dejan ver la fila a sus
-- propios miembros. Para alguien de afuera del grupo, la subconsulta no
-- encuentra esa fila (queda "invisible" por esa regla), así que el envío
-- se sigue rechazando aunque el grupo exista. Mismo problema que
-- chat_es_miembro ya resolvió para chat_miembros, ahora en
-- chat_conversaciones: se mueve a una función security definer, que no
-- vuelve a pasar por esas reglas al mirar la tabla desde adentro.
create or replace function chat_conversacion_es_publica(p_conversacion_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from chat_conversaciones
    where id = p_conversacion_id and tipo in ('general', 'grupo')
  );
$$;

grant execute on function chat_conversacion_es_publica(uuid) to authenticated;

drop policy if exists "Enviar mensajes a mis conversaciones" on chat_mensajes;
drop policy if exists "Enviar mensajes a conversaciones propias, grupos y general" on chat_mensajes;
create policy "Enviar mensajes a conversaciones propias, grupos y general" on chat_mensajes for insert
  with check (
    remitente_id = auth.uid()
    and get_my_role() <> 'personal_logistica'
    and (
      chat_es_miembro(conversacion_id)
      or chat_conversacion_es_publica(conversacion_id)
    )
  );
