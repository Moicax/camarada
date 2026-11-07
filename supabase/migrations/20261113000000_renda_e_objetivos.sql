-- Etapa 2: dinheiro sem salário e objetivos ("Juntar para…").

-- Como a pessoa recebe: salário fixo por mês, mesada (valor fixo por semana) ou renda que varia
-- (bicos, freelas: o limite do dia usa só o que já entrou).
alter table public.perfis
  add column tipo_renda text not null default 'mensal' check (tipo_renda in ('mensal', 'semanal', 'variavel')),
  add column renda_semanal numeric(12,2) not null default 0 check (renda_semanal >= 0);
grant update (tipo_renda, renda_semanal) on public.perfis to authenticated;

-- Objetivos: "R$ 600 para o show até 20/01". O Camarada separa um pouco por mês (ou por semana).
create table public.objetivos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  titulo       text not null check (length(trim(titulo)) between 1 and 60),
  valor_alvo   numeric(12,2) not null check (valor_alvo > 0),
  data_alvo    date not null,
  concluido_em timestamptz,
  criado_em    timestamptz not null default now()
);
create index on public.objetivos (user_id);
alter table public.objetivos enable row level security;
create policy "dono" on public.objetivos for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.objetivos to authenticated;

-- O dinheiro guardado (ou usado) de um objetivo é um lançamento ligado a ele.
alter table public.gastos add column objetivo_id uuid references public.objetivos on delete set null;

create or replace function public.checar_objetivo_do_gasto() returns trigger
language plpgsql security invoker as $$
begin
  if new.objetivo_id is not null and not exists (
    select 1 from public.objetivos o where o.id = new.objetivo_id and o.user_id = new.user_id
  ) then
    raise exception 'Objetivo inválido';
  end if;
  return new;
end $$;

create trigger gastos_checar_objetivo
  before insert or update of objetivo_id on public.gastos
  for each row execute function public.checar_objetivo_do_gasto();

-- A cópia de segurança diária passa a guardar os objetivos também.
create or replace function public.fazer_copias() returns int
language plpgsql security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; n int;
begin
  insert into public.copias (user_id, dia, dados)
  select p.user_id, hoje, jsonb_build_object(
    'perfil',     to_jsonb(p) - 'token_atalho',
    'categorias', coalesce((select jsonb_agg(to_jsonb(c)) from public.categorias c where c.user_id = p.user_id), '[]'),
    'tarefas',    coalesce((select jsonb_agg(to_jsonb(t)) from public.tarefas t where t.user_id = p.user_id), '[]'),
    'cartoes',    coalesce((select jsonb_agg(to_jsonb(k)) from public.cartoes k where k.user_id = p.user_id), '[]'),
    'gastos',     coalesce((select jsonb_agg(to_jsonb(g)) from public.gastos g where g.user_id = p.user_id), '[]'),
    'rendas',     coalesce((select jsonb_agg(to_jsonb(r)) from public.rendas_mes r where r.user_id = p.user_id), '[]'),
    'objetivos',  coalesce((select jsonb_agg(to_jsonb(o)) from public.objetivos o where o.user_id = p.user_id), '[]'))
  from public.perfis p
  on conflict (user_id, dia) do update set dados = excluded.dados;
  get diagnostics n = row_count;
  delete from public.copias where dia < hoje - 13;
  return n;
end $$;
revoke execute on function public.fazer_copias() from public, anon, authenticated;
