-- O "camarada": recompensa da semana e bom dia.

alter table public.perfis
  -- O que a pessoa vai se dar de presente ao bater os pontos da semana (ex.: "Pizza no sábado").
  add column recompensa_texto text check (length(recompensa_texto) <= 80),
  add column recompensa_pontos int not null default 100 check (recompensa_pontos between 10 and 10000),
  -- Mensagem de bom dia no horário dos avisos do dia.
  add column bom_dia boolean not null default true;
grant update (recompensa_texto, recompensa_pontos, bom_dia) on public.perfis to authenticated;

-- Avisos que só podem sair uma vez (ex.: o bom dia de cada dia). Só o servidor mexe aqui.
create table public.avisos_enviados (
  user_id    uuid not null references auth.users on delete cascade,
  chave      text not null check (length(chave) <= 60),
  enviado_em timestamptz not null default now(),
  primary key (user_id, chave)
);
alter table public.avisos_enviados enable row level security;
revoke all on public.avisos_enviados from anon, authenticated;
