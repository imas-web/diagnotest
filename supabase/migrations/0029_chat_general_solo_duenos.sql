-- Mandar mensajes a General se restringe a dueño y super_admin — el resto
-- lo sigue leyendo (nada cambia ahí), solo no puede escribir. Los grupos
-- siguen abiertos como lista de difusión (cualquiera les puede mandar) y
-- las conversaciones propias (DM / grupo del que se es miembro) siguen
-- iguales.
create or replace function chat_conversacion_tipo(p_conversacion_id uuid)
returns chat_tipo_conversacion
language sql
security definer
set search_path = public
stable
as $$
  select tipo from chat_conversaciones where id = p_conversacion_id;
$$;

grant execute on function chat_conversacion_tipo(uuid) to authenticated;

drop policy if exists "Enviar mensajes a mis conversaciones" on chat_mensajes;
drop policy if exists "Enviar mensajes a conversaciones propias, grupos y general" on chat_mensajes;
create policy "Enviar mensajes a conversaciones propias, grupos y general" on chat_mensajes for insert
  with check (
    remitente_id = auth.uid()
    and get_my_role() <> 'personal_logistica'
    and (
      chat_es_miembro(conversacion_id)
      or chat_conversacion_tipo(conversacion_id) = 'grupo'
      or (
        chat_conversacion_tipo(conversacion_id) = 'general'
        and get_my_role() in ('dueno', 'super_admin')
      )
    )
  );
