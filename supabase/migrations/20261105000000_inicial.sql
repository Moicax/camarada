-- Camarada: estrutura inicial.
-- Cada pessoa tem a própria conta (Supabase Auth) e só enxerga os próprios dados (RLS).

create extension if not exists pgcrypto;

-- ---------- perfil ----------
create table public.perfis (
  user_id      uuid primary key references auth.users on delete cascade,
  nome         text,
  renda_mensal numeric(12,2) not null default 0 check (renda_mensal >= 0),
  -- Código secreto que o Atalho do iPhone usa para registrar compras nesta conta.
  token_atalho text not null unique default encode(gen_random_bytes(24), 'hex'),
  criado_em    timestamptz not null default now()
);

-- ---------- tarefas ----------
create table public.categorias (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  nome       text not null check (length(trim(nome)) between 1 and 40),
  aviso_dias int  not null default 3 check (aviso_dias between 0 and 90),
  criado_em  timestamptz not null default now()
);
create index on public.categorias (user_id);

create table public.tarefas (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users on delete cascade,
  titulo          text not null check (length(trim(titulo)) between 1 and 120),
  notas           text check (length(notas) <= 2000),
  vencimento      date not null,
  categoria_id    uuid references public.categorias on delete set null,
  concluida_em    timestamptz,
  -- Avisos já enviados para não repetir: 'entrou', 'vespera', 'hoje', 'atrasada'.
  avisos_enviados text[] not null default '{}',
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index on public.tarefas (user_id, concluida_em, vencimento);

-- ---------- finanças ----------
create table public.cartoes (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  nome      text not null check (length(trim(nome)) between 1 and 60),
  criado_em timestamptz not null default now(),
  unique (user_id, nome)
);

create table public.gastos (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users on delete cascade,
  valor           numeric(12,2) not null check (valor <> 0),
  estabelecimento text check (length(estabelecimento) <= 120),
  cartao_id       uuid references public.cartoes on delete set null,
  data            timestamptz not null default now(),
  -- De onde veio: digitado no app, Atalho do iPhone, ou Open Finance (futuro).
  origem          text not null default 'manual' check (origem in ('manual', 'atalho', 'openfinance')),
  id_externo      text,
  criado_em       timestamptz not null default now(),
  unique (user_id, origem, id_externo)
);
create index on public.gastos (user_id, data desc);

-- Renda de um mês específico, quando for diferente da renda mensal padrão.
create table public.rendas_mes (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  mes     text not null check (mes ~ '^\d{4}-\d{2}$'),
  valor   numeric(12,2) not null check (valor >= 0),
  primary key (user_id, mes)
);

-- ---------- notificações ----------
create table public.inscricoes_push (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint  text not null unique,
  p256dh    text not null,
  auth      text not null,
  criado_em timestamptz not null default now()
);
create index on public.inscricoes_push (user_id);

-- ---------- segurança: cada um só vê o que é seu ----------
alter table public.perfis          enable row level security;
alter table public.categorias      enable row level security;
alter table public.tarefas         enable row level security;
alter table public.cartoes         enable row level security;
alter table public.gastos          enable row level security;
alter table public.rendas_mes      enable row level security;
alter table public.inscricoes_push enable row level security;

create policy "perfil próprio" on public.perfis
  for select using (user_id = auth.uid());
create policy "perfil próprio (editar)" on public.perfis
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "dono" on public.categorias      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dono" on public.tarefas         for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dono" on public.cartoes         for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dono" on public.gastos          for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dono" on public.rendas_mes      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dono" on public.inscricoes_push for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- No perfil, o app só pode mudar nome e renda (o código do Atalho muda pela função abaixo).
revoke update on public.perfis from anon, authenticated;
grant update (nome, renda_mensal) on public.perfis to authenticated;

-- A tarefa pertence a quem a criou, e a categoria escolhida também tem que ser da pessoa.
create or replace function public.checar_categoria() returns trigger
language plpgsql security invoker as $$
begin
  if new.categoria_id is not null and not exists (
    select 1 from public.categorias c where c.id = new.categoria_id and c.user_id = new.user_id
  ) then
    raise exception 'Categoria inválida';
  end if;
  new.atualizado_em := now();
  return new;
end $$;

create trigger tarefas_checar_categoria
  before insert or update on public.tarefas
  for each row execute function public.checar_categoria();

create or replace function public.checar_cartao() returns trigger
language plpgsql security invoker as $$
begin
  if new.cartao_id is not null and not exists (
    select 1 from public.cartoes c where c.id = new.cartao_id and c.user_id = new.user_id
  ) then
    raise exception 'Cartão inválido';
  end if;
  return new;
end $$;

create trigger gastos_checar_cartao
  before insert or update on public.gastos
  for each row execute function public.checar_cartao();

-- ---------- conta nova: cria perfil e categorias iniciais ----------
create or replace function public.nova_conta() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (user_id, nome)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', null));
  insert into public.categorias (user_id, nome, aviso_dias) values
    (new.id, 'Contas', 5),
    (new.id, 'Documentos', 15),
    (new.id, 'Geral', 3);
  return new;
end $$;

create trigger ao_criar_conta
  after insert on auth.users
  for each row execute function public.nova_conta();

-- Gera um novo código do Atalho (se o antigo vazar, o antigo para de funcionar).
create or replace function public.novo_token_atalho() returns text
language plpgsql security definer set search_path = public as $$
declare novo text := encode(gen_random_bytes(24), 'hex');
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  update public.perfis set token_atalho = novo where user_id = auth.uid();
  return novo;
end $$;

revoke execute on function public.novo_token_atalho() from public, anon;
grant execute on function public.novo_token_atalho() to authenticated;
