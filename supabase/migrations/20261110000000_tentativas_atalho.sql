-- Registro das chamadas do Atalho do Apple Pay (para descobrir por que uma compra não entrou).
-- Só o servidor lê e grava; guarda 14 dias.
create table public.tentativas_atalho (
  id        bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  user_id   uuid references auth.users on delete cascade,
  status    smallint not null,
  motivo    text,
  formato   jsonb
);
alter table public.tentativas_atalho enable row level security;
revoke all on public.tentativas_atalho from anon, authenticated;
