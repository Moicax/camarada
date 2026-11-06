-- Correções da revisão.

-- 1) Notificações num aparelho que troca de conta: a inscrição (endpoint) é do aparelho, não da
--    pessoa. Antes, a segunda pessoa não conseguia se inscrever (a linha era da primeira, e o RLS
--    barrava) e o aparelho continuava recebendo os avisos da primeira. Agora quem está entrando
--    no aparelho fica com a inscrição.
create or replace function public.registrar_inscricao_push(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if length(p_endpoint) > 2000 or p_endpoint !~ '^https://' then raise exception 'Inscrição inválida'; end if;
  insert into public.inscricoes_push (user_id, endpoint, p256dh, auth)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth)
    on conflict (endpoint) do update
      set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, criado_em = now();
end $$;
revoke execute on function public.registrar_inscricao_push(text, text, text) from public, anon;
grant execute on function public.registrar_inscricao_push(text, text, text) to authenticated;

-- 2) Senha do app antigo: como lá, depois de 20 erros seguidos espera 15 minutos.
alter table public.contas_antigas
  add column tentativas int not null default 0,
  add column bloqueado_ate timestamptz;

-- 3) Quem veio do app antigo com o Atalho do Apple Pay já configurado: o app avisa que ele
--    continua funcionando (em vez de pedir para instalar outro).
alter table public.perfis add column atalho_antigo boolean not null default false;
update public.perfis p set atalho_antigo = true
  from public.contas_antigas a where a.user_id = p.user_id and a.atalho_hash is not null;

-- 4) Gastos copiados do app antigo (que só guardava o dia) apareciam todos às 12:00. Quando o
--    lançamento foi feito no mesmo dia, usa a hora em que foi lançado.
update public.gastos g set data = g.criado_em
  where g.id_externo like 'antigo:%'
    and (g.criado_em at time zone 'America/Sao_Paulo')::date = (g.data at time zone 'America/Sao_Paulo')::date
    and (g.data at time zone 'America/Sao_Paulo')::time = '12:00';
