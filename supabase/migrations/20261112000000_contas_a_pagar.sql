-- "Dinheiro com dono": a tarefa pode ter valor (conta de luz, aluguel, boleto). Enquanto está
-- aberta, o valor sai do que dá para gastar; ao concluir, "Paguei" registra o gasto.
alter table public.tarefas add column valor numeric(12,2) check (valor is null or valor > 0);

-- O gasto que pagou uma conta guarda de qual tarefa veio. Esse dinheiro já estava separado,
-- então pagar a conta não come o limite do dia (só o do mês, que já contava com ela).
alter table public.gastos add column tarefa_id uuid references public.tarefas on delete set null;

-- A conta ligada ao gasto tem que ser da mesma pessoa.
create or replace function public.checar_tarefa_do_gasto() returns trigger
language plpgsql security invoker as $$
begin
  if new.tarefa_id is not null and not exists (
    select 1 from public.tarefas t where t.id = new.tarefa_id and t.user_id = new.user_id
  ) then
    raise exception 'Conta inválida';
  end if;
  return new;
end $$;

create trigger gastos_checar_tarefa
  before insert or update of tarefa_id on public.gastos
  for each row execute function public.checar_tarefa_do_gasto();
