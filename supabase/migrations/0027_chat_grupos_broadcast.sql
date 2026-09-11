-- Los grupos (canales de sector) pasan a funcionar también como lista de
-- difusión: cualquier usuario con acceso al chat puede mandar un mensaje a
-- un grupo aunque no sea miembro de él, igual que ya podía hacerlo en
-- General. No cambia quién puede LEER el historial del grupo (sigue siendo
-- solo para sus miembros) — es un envío de una sola vía, no un alta
-- automática como miembro.
drop policy if exists "Enviar mensajes a mis conversaciones" on chat_mensajes;
create policy "Enviar mensajes a conversaciones propias, grupos y general" on chat_mensajes for insert
  with check (
    remitente_id = auth.uid()
    and get_my_role() <> 'personal_logistica'
    and (
      chat_es_miembro(conversacion_id)
      or conversacion_id in (select id from chat_conversaciones where tipo in ('general', 'grupo'))
    )
  );
