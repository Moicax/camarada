// Bom dia do Camarada: um resumo curto do dia, no horário que a pessoa escolheu para os avisos.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { somarDias, chaveMes, mudarMes, diaLocal } from './dates.js';
import { resumoMes, numeroDoDia, rendaDoMes } from './finance.js';
import { resumoCamarada, contarHoje, conselho, cumprimento, proximaConta } from './camarada.js';
import { enviarPush } from './push.ts';

const FUSO = 'America/Sao_Paulo';
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const real = (n: number) => BRL.format(n).replace(/ /g, ' ');

/** Monta a mensagem do dia de uma pessoa. */
export async function mensagemDoDia(supabase: SupabaseClient, userId: string, hoje: string, hora: number) {
  const mesAtual = chaveMes(hoje);
  const mesAnterior = mudarMes(mesAtual, -1);
  const [a, m] = mesAnterior.split('-').map(Number);
  const desde = new Date(Date.UTC(a, m - 1, 1, 3)).toISOString(); // 1º do mês anterior, 0h em Brasília

  const [perfil, tarefas, gastos, rendas, objetivos, movimentos] = await Promise.all([
    supabase.from('perfis').select('nome, renda_mensal, tipo_renda, renda_semanal, meta_gasto, recompensa_texto, recompensa_pontos, criado_em').eq('user_id', userId).single(),
    supabase.from('tarefas').select('id, titulo, vencimento, concluida_em, valor').eq('user_id', userId)
      .or(`concluida_em.is.null,concluida_em.gte.${somarDias(hoje, -62)}`),
    supabase.from('gastos').select('valor, data, forma, investimento, tarefa_id, objetivo_id').eq('user_id', userId).gte('data', desde),
    supabase.from('rendas_mes').select('mes, valor').eq('user_id', userId).in('mes', [mesAnterior, mesAtual]),
    supabase.from('objetivos').select('id, titulo, valor_alvo, data_alvo, concluido_em').eq('user_id', userId).is('concluido_em', null),
    supabase.from('gastos').select('objetivo_id, valor, data, investimento').eq('user_id', userId).not('objetivo_id', 'is', null).eq('investimento', true),
  ]);
  for (const r of [perfil, tarefas, gastos, rendas, objetivos, movimentos]) if (r.error) throw r.error;
  const p = perfil.data!;
  const tipoRenda = p.tipo_renda ?? 'mensal';
  // Renda do mês conforme o jeito de receber (salário pode ter um valor diferente só naquele mês).
  const rendaDe = (mes: string) => (tipoRenda === 'mensal'
    ? Number((rendas.data ?? []).find((r) => r.mes === mes)?.valor ?? p.renda_mensal ?? 0)
    : rendaDoMes({ tipoRenda, rendaSemanal: Number(p.renda_semanal) || 0, mes }));

  const camarada = resumoCamarada({
    tarefas: tarefas.data ?? [], gastos: gastos.data ?? [], rendaDe, hoje, timeZone: FUSO,
    metaPontos: p.recompensa_pontos, recompensa: p.recompensa_texto,
    desde: p.criado_em ? diaLocal(new Date(p.criado_em), FUSO) : undefined,
  });
  // O número do dia: o mesmo do app (salário, mesada ou o que entrou; contas e objetivos já separados).
  const dia = numeroDoDia({
    tipoRenda, renda: rendaDe(mesAtual), rendaSemanal: Number(p.renda_semanal) || 0, gastos: gastos.data ?? [],
    tarefas: tarefas.data ?? [], objetivos: objetivos.data ?? [], movimentos: movimentos.data ?? [], hoje, timeZone: FUSO,
  });
  // A meta de gastos é do mês.
  const fin = resumoMes({ renda: 0, gastos: gastos.data ?? [], mes: mesAtual, hoje, timeZone: FUSO, metaGasto: Number(p.meta_gasto) || 0 });
  const { atrasadas, vencemHoje } = contarHoje(tarefas.data ?? [], hoje);

  const partes: string[] = [];
  const paraHoje = atrasadas + vencemHoje;
  partes.push(paraHoje ? `${paraHoje} ${paraHoje === 1 ? 'tarefa' : 'tarefas'} para hoje` : 'nenhuma tarefa para hoje');
  if (dia.restaHoje !== null) partes.push(`${real(dia.restaHoje)} para gastar`);
  partes.push(`${camarada.pontos}/${camarada.meta} pontos`);
  if (camarada.sequencia >= 2) partes.push(`${camarada.sequencia} dias seguidos`);

  const nome = (p.nome ?? '').trim().split(/\s+/)[0];
  return {
    titulo: `${cumprimento(hora)}${nome ? `, ${nome}` : ''}!`,
    corpo: `${partes.join(' · ')}. ${conselho({ atrasadas, vencemHoje, nivelMeta: fin.metaGasto?.nivel ?? null, restaHoje: dia.restaHoje, camarada, conta: proximaConta(dia.compromissos, hoje) })}`,
  };
}

/** Manda o bom dia (uma vez por dia) para quem escolheu esta hora e não desligou o bom dia. */
export async function bomDia(supabase: SupabaseClient, hoje: string, hora: number) {
  const { data: pessoas, error } = await supabase.from('perfis').select('user_id').eq('horario_aviso', hora).eq('bom_dia', true);
  if (error) throw error;
  let enviados = 0;
  for (const { user_id } of pessoas ?? []) {
    try {
      const { data: novo, error: e } = await supabase.from('avisos_enviados')
        .upsert({ user_id, chave: `bomdia-${hoje}` }, { onConflict: 'user_id,chave', ignoreDuplicates: true }).select('chave');
      if (e) throw e;
      if (!novo?.length) continue; // já mandou hoje
      const msg = await mensagemDoDia(supabase, user_id, hoje, hora);
      enviados += await enviarPush(supabase, user_id, { ...msg, url: '/#hoje', tag: `bomdia-${hoje}` });
    } catch (e) {
      console.error('Falha no bom dia', user_id, e);
    }
  }
  return { pessoas: pessoas?.length ?? 0, enviados };
}
