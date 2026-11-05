import { diasEntre, somarDias, somarMeses, diaCurto } from './dates.js';

/** Dias de antecedência padrão para uma tarefa entrar em "Vencendo". */
export const AVISO_PADRAO = 3;

export const ABAS = ['pendentes', 'vencendo', 'concluidas'];

/** Em qual aba a tarefa fica. */
export function classificar(tarefa, avisoDias, hoje) {
  if (tarefa.concluida_em) return 'concluidas';
  const faltam = diasEntre(hoje, tarefa.vencimento);
  return faltam <= avisoDias ? 'vencendo' : 'pendentes';
}

/**
 * Separa as tarefas nas três abas, já ordenadas.
 * `avisoDe(tarefa)` devolve os dias de aviso da categoria da tarefa.
 */
export function separar(tarefas, avisoDe, hoje) {
  const abas = { pendentes: [], vencendo: [], concluidas: [] };
  for (const t of tarefas) abas[classificar(t, avisoDe(t), hoje)].push(t);
  const porVencimento = (a, b) =>
    a.vencimento.localeCompare(b.vencimento) || a.titulo.localeCompare(b.titulo, 'pt-BR');
  abas.pendentes.sort(porVencimento);
  abas.vencendo.sort(porVencimento);
  abas.concluidas.sort((a, b) => b.concluida_em.localeCompare(a.concluida_em));
  return abas;
}

/** Texto do prazo: 'Venceu ontem', 'Vence hoje', 'Vence em 5 dias'... */
export function rotuloPrazo(vencimento, hoje) {
  const faltam = diasEntre(hoje, vencimento);
  if (faltam < -1) return `Venceu há ${-faltam} dias`;
  if (faltam === -1) return 'Venceu ontem';
  if (faltam === 0) return 'Vence hoje';
  if (faltam === 1) return 'Vence amanhã';
  if (faltam <= 30) return `Vence em ${faltam} dias`;
  return `Vence em ${diaCurto(vencimento)}`;
}

export const OPCOES_ADIAR = [
  { id: '1d', rotulo: '1 dia', dias: 1 },
  { id: '3d', rotulo: '3 dias', dias: 3 },
  { id: '1s', rotulo: '1 semana', dias: 7 },
  { id: '1m', rotulo: '1 mês', meses: 1 },
];

/**
 * Nova data ao adiar. Conta a partir do vencimento, ou de hoje se já venceu
 * (adiar uma conta atrasada "1 dia" deve jogar para amanhã, não para ontem).
 */
export function adiar(vencimento, opcaoId, hoje) {
  const opcao = OPCOES_ADIAR.find((o) => o.id === opcaoId);
  if (!opcao) throw new Error(`Opção de adiar desconhecida: ${opcaoId}`);
  const base = vencimento < hoje ? hoje : vencimento;
  return opcao.meses ? somarMeses(base, opcao.meses) : somarDias(base, opcao.dias);
}

/**
 * Qual aviso enviar hoje para a tarefa, ou null.
 * 'entrou' (entrou em Vencendo), 'vespera', 'hoje', 'atrasada' (dia seguinte ao vencimento).
 * Avisos já enviados (lista `avisos_enviados`) não se repetem.
 */
export function etapaAviso(tarefa, avisoDias, hoje) {
  if (tarefa.concluida_em) return null;
  const faltam = diasEntre(hoje, tarefa.vencimento);
  let etapa = null;
  if (faltam === -1) etapa = 'atrasada';
  else if (faltam === 0) etapa = 'hoje';
  else if (faltam === 1) etapa = 'vespera';
  else if (faltam > 1 && faltam <= avisoDias) etapa = 'entrou';
  const enviados = tarefa.avisos_enviados || [];
  return etapa && !enviados.includes(etapa) ? etapa : null;
}

export function textoAviso(etapa, tarefa) {
  switch (etapa) {
    case 'entrou':
      return { titulo: 'Vencendo em breve', corpo: `${tarefa.titulo} vence em ${diaCurto(tarefa.vencimento)}.` };
    case 'vespera':
      return { titulo: 'Vence amanhã', corpo: tarefa.titulo };
    case 'hoje':
      return { titulo: 'Vence hoje', corpo: tarefa.titulo };
    case 'atrasada':
      return { titulo: 'Venceu ontem', corpo: `${tarefa.titulo} ainda não foi concluída.` };
    default:
      return null;
  }
}
