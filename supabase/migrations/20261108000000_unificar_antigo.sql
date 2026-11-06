-- Junta o app antigo (Netlify) com o novo: entrar com nome e senha, convite para criar conta,
-- uma conta "dono" que cuida das pessoas, a senha e o endereço do Apple Pay de antes continuando
-- a valer, e uma cópia de segurança por dia de cada conta.

-- Nome de entrada ("Moisés" → moises) e quem cuida do app.
alter table public.perfis
  add column login text unique check (login ~ '^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$'),
  add column dono boolean not null default false;

-- Conta que veio do app antigo. A senha antiga (scrypt "sal:hash") vale até a primeira entrada,
-- quando vira a senha do login novo e é apagada daqui. O resumo do endereço secreto do
-- Apple Pay deixa o Atalho que já está no iPhone funcionando sem mudar nada.
create table public.contas_antigas (
  user_id     uuid primary key references auth.users on delete cascade,
  id_antigo   text not null unique check (id_antigo ~ '^[a-f0-9]{16}$'),
  login       text not null unique,
  senha_hash  text,
  atalho_hash text unique,
  copiado_em  timestamptz not null default now()
);
alter table public.contas_antigas enable row level security;
revoke all on public.contas_antigas from anon, authenticated;

-- Link de convite (só um vale por vez; trocar o link desliga o anterior).
create table public.convite (
  id        smallint primary key default 1 check (id = 1),
  codigo    text not null,
  criado_em timestamptz not null default now()
);
alter table public.convite enable row level security;
revoke all on public.convite from anon, authenticated;

-- Cópia de segurança: uma por dia por conta, guardando as últimas 14.
create table public.copias (
  user_id uuid not null references auth.users on delete cascade,
  dia     date not null,
  dados   jsonb not null,
  primary key (user_id, dia)
);
alter table public.copias enable row level security;
revoke all on public.copias from anon, authenticated;

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
    'rendas',     coalesce((select jsonb_agg(to_jsonb(r)) from public.rendas_mes r where r.user_id = p.user_id), '[]'))
  from public.perfis p
  on conflict (user_id, dia) do update set dados = excluded.dados;
  get diagnostics n = row_count;
  delete from public.copias where dia < hoje - 13;
  return n;
end $$;
revoke execute on function public.fazer_copias() from public, anon, authenticated;
