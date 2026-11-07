// O "camarada": pontos, sequência de dias, recompensa da semana e o conselho do dia.
//
// Os pontos não ficam guardados num placar: são calculados a partir do que a pessoa fez
// (tarefas concluídas, gastos, investimentos). Reabrir uma tarefa tira os pontos dela;
// apagar um investimento também. Assim o número é sempre honesto.
import { diaLocal, somarDias, chaveMes, diasEntre, inicioDaSemana } from './dates.js';
import { resumoMes, diaDoGasto, formatarReal } from './finance.js';

export const PONTOS = {
  tarefaNoPrazo: 10,
  tarefaAtrasada: 5,
  diaNoLimite: 5,
  investimento: 15,
};

export const RECOMPENSA_PADRAO = 100;

// Segunda-feira da semana do dia (a semana vai de segunda a domingo): mora em dates.js.
export { inicioDaSemana };

/**
 * Tudo o que deu pontos entre `de` e `ate` (inclusive), do mais recente para o mais antigo.
 *  - tarefa concluída: +10 no prazo (ou sem data), +5 atrasada; conta no dia em que foi concluída;
 *  - dia dentro do limite: +5 para cada dia já encerrado em que o gasto ficou dentro do limite
 *    daquele dia (só quando há renda informada);
 *  - investimento: +15 por dia em que houve investimento.
 * `rendaDe(mes)` devolve a renda do mês ('AAAA-MM'). `desde` é o dia em que a pessoa começou a usar
 * o app: dias antes disso não contam (senão uma conta nova já nasceria com dias "dentro do limite").
 */
export function eventos({ tarefas = [], gastos = [], rendaDe = () => 0, de, ate, hoje, timeZone, desde }) {
  const lista = [];
  for (const t of tarefas) {
    if (!t.concluida_em) continue;
    const dia = diaLocal(new Date(t.concluida_em), timeZone);
    if (dia < de || dia > ate) continue;
    const noPrazo = !t.vencimento || dia <= t.vencimento;
    lista.push({
      dia,
      tipo: noPrazo ? 'tarefa' : 'tarefa-atrasada',
      pontos: noPrazo ? PONTOS.tarefaNoPrazo : PONTOS.tarefaAtrasada,
      texto: t.titulo,
    });
  }

  const comDia = gastos.map((g) => ({ ...g, dia: diaDoGasto(g, timeZone) }));
  const investiu = new Set(comDia.filter((g) => g.investimento && Number(g.valor) > 0).map((g) => g.dia));
  for (let d = de; d <= ate; d = somarDias(d, 1)) {
    if (investiu.has(d)) lista.push({ dia: d, tipo: 'investimento', pontos: PONTOS.investimento, texto: 'Investiu' });
    if (d >= hoje) continue; // o dia só fecha quando acaba
    if (desde && d < desde) continue; // antes de começar a usar o app
    const mes = chaveMes(d);
    const renda = Number(rendaDe(mes)) || 0;
    if (renda <= 0) continue;
    // O limite do dia é calculado só com o que tinha acontecido até aquele dia.
    const ateODia = comDia.filter((g) => chaveMes(g.dia) === mes && g.dia <= d);
    const r = resumoMes({ renda, gastos: ateODia, mes, hoje: d });
    if (r.porDia !== null && r.gastoHoje <= r.porDia) {
      lista.push({ dia: d, tipo: 'limite', pontos: PONTOS.diaNoLimite, texto: 'Dia dentro do limite' });
    }
  }
  return lista.sort((a, b) => b.dia.localeCompare(a.dia) || b.pontos - a.pontos);
}

/**
 * Dias seguidos com pelo menos uma coisa boa (tarefa concluída, dia no limite ou investimento).
 * Conta até ontem; se hoje já teve algo, hoje entra também.
 */
export function sequencia({ eventos: lista, hoje }) {
  const dias = new Set(lista.map((e) => e.dia));
  let d = dias.has(hoje) ? hoje : somarDias(hoje, -1);
  let n = 0;
  while (dias.has(d)) {
    n += 1;
    d = somarDias(d, -1);
  }
  return n;
}

/** Resumo do camarada: pontos da semana, recompensa e sequência. */
export function resumoCamarada({ tarefas, gastos, rendaDe, hoje, timeZone, metaPontos, recompensa, desde }) {
  const de = inicioDaSemana(hoje);
  const ate = somarDias(de, 6);
  const daSemana = eventos({ tarefas, gastos, rendaDe, de, ate, hoje, timeZone, desde });
  const pontos = daSemana.reduce((t, e) => t + e.pontos, 0);
  const meta = Number(metaPontos) > 0 ? Number(metaPontos) : RECOMPENSA_PADRAO;
  const historico = eventos({ tarefas, gastos, rendaDe, de: somarDias(hoje, -60), ate: hoje, hoje, timeZone, desde });
  return {
    semana: { de, ate },
    pontos,
    meta,
    falta: Math.max(0, meta - pontos),
    pct: Math.min(1, pontos / meta),
    liberada: pontos >= meta,
    recompensa: recompensa?.trim() || null,
    sequencia: sequencia({ eventos: historico, hoje }),
    eventos: daSemana,
  };
}

/** Cumprimento pela hora do dia. */
export function cumprimento(hora) {
  if (hora < 5) return 'Boa noite';
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * O conselho do dia: uma frase curta, do jeito de um amigo, com a coisa mais importante agora.
 * Recebe contagens simples para funcionar igual no app e no servidor.
 */
/**
 * @param {{ atrasadas?: number, vencemHoje?: number, nivelMeta?: number | null, restaHoje?: number | null,
 *   camarada?: { liberada?: boolean, recompensa?: string | null, falta?: number, sequencia?: number } }} dados
 * @returns {string}
 */
/**
 * A conta a pagar mais próxima que vence hoje ou amanhã (para o Camarada avisar), ou null.
 * `compromissos` vem de compromissosDoMes (já ordenado por vencimento).
 */
export function proximaConta(compromissos, hoje) {
  for (const c of compromissos ?? []) {
    if (c.objetivo) continue; // a reserva de um objetivo não "vence"
    const d = diasEntre(hoje, c.vencimento);
    if (d === 0 || d === 1) return { titulo: c.titulo, valor: c.valor, quando: d === 0 ? 'hoje' : 'amanhã' };
  }
  return null;
}

export function conselho({ atrasadas = 0, vencemHoje = 0, nivelMeta = null, restaHoje = null, camarada, conta = null }) {
  const plural = (n, um, varios) => (n === 1 ? um : varios);
  if (camarada?.liberada && camarada.recompensa) return `Você bateu a meta da semana. Aproveite: ${camarada.recompensa}!`;
  if (atrasadas > 0) return `${atrasadas} ${plural(atrasadas, 'tarefa está atrasada', 'tarefas estão atrasadas')}. Que tal resolver ${plural(atrasadas, 'ela', 'uma delas')} hoje?`;
  if (conta) return `${conta.titulo} vence ${conta.quando}: ${formatarReal(conta.valor)} já estão separados.`;
  if (nivelMeta === 100) return 'Você passou da meta de gastos do mês. Segura os gastos até virar o mês.';
  if (restaHoje !== null && restaHoje < 0) return 'Hoje já passou do limite do dia. Amanhã é um novo dia: segura um pouco.';
  if (nivelMeta === 80) return 'Você já usou mais de 80% da meta de gastos. Vai com calma até o fim do mês.';
  if (vencemHoje > 0) return `${vencemHoje} ${plural(vencemHoje, 'tarefa vence', 'tarefas vencem')} hoje. Bora resolver?`;
  if (camarada && camarada.falta > 0 && camarada.falta <= 20) return `Faltam só ${camarada.falta} pontos para a sua recompensa!`;
  if (camarada?.sequencia >= 3) return `${camarada.sequencia} dias seguidos fazendo o que precisa. Continua assim!`;
  return 'Tudo em dia. Bom trabalho!';
}

/** Quantas tarefas abertas estão atrasadas e quantas vencem hoje. */
export function contarHoje(tarefas, hoje) {
  let atrasadas = 0;
  let vencemHoje = 0;
  for (const t of tarefas) {
    if (t.concluida_em || !t.vencimento) continue;
    const d = diasEntre(hoje, t.vencimento);
    if (d < 0) atrasadas += 1;
    else if (d === 0) vencemHoje += 1;
  }
  return { atrasadas, vencemHoje };
}
