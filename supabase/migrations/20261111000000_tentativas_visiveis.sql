-- Cada pessoa vê as próprias tentativas do Atalho do Apple Pay (para o app mostrar se está
-- conectado ou o que corrigir). Gravar continua sendo só do servidor.
create policy "dono (ler)" on public.tentativas_atalho for select using (user_id = auth.uid());
grant select on public.tentativas_atalho to authenticated;
