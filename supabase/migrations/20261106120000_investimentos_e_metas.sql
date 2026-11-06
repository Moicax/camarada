-- Investimentos e metas do mês.

-- Lançamento de investimento: sai do que dá para gastar no mês, mas não conta como gasto.
-- (valor positivo = aplicou; negativo = resgatou)
alter table public.gastos add column investimento boolean not null default false;

-- Metas (0 = sem meta).
alter table public.perfis
  add column meta_gasto numeric(12,2) not null default 0 check (meta_gasto >= 0),
  add column meta_investimento numeric(12,2) not null default 0 check (meta_investimento >= 0);
grant update (meta_gasto, meta_investimento) on public.perfis to authenticated;

-- Avisos da meta de gastos já enviados (80% e 100%), para chegar uma vez por mês cada.
-- Só o servidor mexe aqui (sem acesso pelo app).
create table public.avisos_meta (
  user_id    uuid not null references auth.users on delete cascade,
  mes        text not null check (mes ~ '^\d{4}-\d{2}$'),
  nivel      smallint not null check (nivel in (80, 100)),
  enviado_em timestamptz not null default now(),
  primary key (user_id, mes, nivel)
);
alter table public.avisos_meta enable row level security;
revoke all on public.avisos_meta from anon, authenticated;

-- Mudou a meta de gastos: os avisos do mês voltam a valer para a meta nova.
create or replace function public.meta_mudou() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.meta_gasto is distinct from old.meta_gasto then
    delete from public.avisos_meta
     where user_id = new.user_id
       and mes = to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM');
  end if;
  return new;
end $$;

create trigger perfis_meta_mudou
  after update of meta_gasto on public.perfis
  for each row execute function public.meta_mudou();
