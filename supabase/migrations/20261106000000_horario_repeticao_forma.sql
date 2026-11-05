-- Recursos que a versão antiga do Camarada já tinha:
-- horário na tarefa (com lembretes 3h, 1h e 10 min antes), tarefas que repetem, tarefa sem data,
-- crédito × à vista nos gastos, cartões de débito e horário escolhido para o aviso diário.

-- ---------- tarefas ----------
alter table public.tarefas alter column vencimento drop not null;
alter table public.tarefas
  add column hora time,
  add column recorrencia text check (recorrencia in ('semanal', 'mensal', 'anual')),
  add column dia_original smallint check (dia_original between 1 and 31),
  add column gerado_de uuid references public.tarefas on delete set null;

-- Repetir exige data.
alter table public.tarefas add constraint tarefas_repetir_com_data check (recorrencia is null or vencimento is not null);

-- Lembretes por horário: o agendamento de minuto em minuto só olha tarefas abertas com horário.
create index tarefas_com_horario on public.tarefas (vencimento, hora) where concluida_em is null and hora is not null;

-- A categoria e a tarefa de origem também têm que ser da própria pessoa.
create or replace function public.checar_categoria() returns trigger
language plpgsql security invoker as $$
begin
  if new.categoria_id is not null and not exists (
    select 1 from public.categorias c where c.id = new.categoria_id and c.user_id = new.user_id
  ) then
    raise exception 'Categoria inválida';
  end if;
  if new.gerado_de is not null and not exists (
    select 1 from public.tarefas t where t.id = new.gerado_de and t.user_id = new.user_id
  ) then
    raise exception 'Tarefa de origem inválida';
  end if;
  new.atualizado_em := now();
  return new;
end $$;

-- ---------- finanças ----------
-- Crédito vai para a fatura do cartão; à vista (débito, Pix, dinheiro) sai do salário na hora.
alter table public.gastos add column forma text not null default 'credito' check (forma in ('credito', 'avista'));
-- Compras do Apple Pay com cartão marcado como débito entram como à vista.
alter table public.cartoes add column debito boolean not null default false;

-- ---------- avisos ----------
-- Hora (de Brasília) em que chegam os avisos do dia: entrou em Vencendo, véspera, dia, atrasada.
alter table public.perfis add column horario_aviso smallint not null default 9 check (horario_aviso between 0 and 23);
grant update (horario_aviso) on public.perfis to authenticated;
