import { diasEntre, somarDias, somarMeses, diaCurto } from './dates.js';

/** Dias de antecedência padrão para uma tarefa entrar em "Vencendo". */
export const AVISO_PADRAO = 3;

export const ABAS = ['pendentes', 'vencendo', 'concluidas'];

/** 'HH:MM' de um horário vindo do banco ('18:00:00') ou do formulário ('18:00'). */
export function normalizarHora(hora) {
  if (!hora) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(String(hora));
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Jeito falado: '18:00' → '18h', '09:30' → '9h30'. */
export function horaCurta(hora) {
  const h = normalizarHora(hora);
  if (!h) return '';
  const [hh, mm] = h.split(':');
  return `${Number(hh)}h${mm === '00' ? '' : mm}`;
}

const minutosDe = (hora) => {
  const [hh, mm] = normalizarHora(hora).split(':').map(Number);
  return hh * 60 + mm;
};

/** Em qual aba a tarefa fica. Tarefa sem data fica em Pendentes. */
export function classificar(tarefa, avisoDias, hoje) {
  if (tarefa.concluida_em) return 'concluidas';
  if (!tarefa.vencimento) return 'pendentes';
  const faltam = diasEntre(hoje, tarefa.vencimento);
  return faltam <= avisoDias ? 'vencendo' : 'pendentes';
}

/**
 * Separa as tarefas nas três abas, já ordenadas.
 * `avisoDe(tarefa)` devolve os dias de aviso da categoria da tarefa.
 * No mesmo dia, a que tem horário mais cedo vem antes; sem horário fica no fim do dia;
 * sem data fica no fim da lista.
 */
export function separar(tarefas, avisoDe, hoje) {
  const abas = { pendentes: [], vencendo: [], concluidas: [] };
  for (const t of tarefas) abas[classificar(t, avisoDe(t), hoje)].push(t);
  const prazo = (t) => (t.vencimento || '9999-12-31') + (normalizarHora(t.hora) || '24:00');
  const porPrazo = (a, b) => prazo(a).localeCompare(prazo(b)) || a.titulo.localeCompare(b.titulo, 'pt-BR');
  abas.pendentes.sort(porPrazo);
  abas.vencendo.sort(porPrazo);
  abas.concluidas.sort((a, b) => b.concluida_em.localeCompare(a.concluida_em));
  return abas;
}

/** Texto do prazo: 'Venceu ontem', 'Vence hoje às 18h', 'Vence em 5 dias', 'Sem data'... */
export function rotuloPrazo(vencimento, hoje, hora) {
  if (!vencimento) return 'Sem data';
  const faltam = diasEntre(hoje, vencimento);
  const as = hora ? ` às ${horaCurta(hora)}` : '';
  if (faltam < -1) return `Venceu há ${-faltam} dias`;
  if (faltam === -1) return 'Venceu ontem';
  if (faltam === 0) return `Vence hoje${as}`;
  if (faltam === 1) return `Vence amanhã${as}`;
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
 * Nova data ao adiar. Conta a partir do vencimento, ou de hoje se já venceu ou não tem data
 * (adiar uma conta atrasada "1 dia" deve jogar para amanhã, não para ontem).
 */
export function adiar(vencimento, opcaoId, hoje) {
  const opcao = OPCOES_ADIAR.find((o) => o.id === opcaoId);
  if (!opcao) throw new Error(`Opção de adiar desconhecida: ${opcaoId}`);
  const base = !vencimento || vencimento < hoje ? hoje : vencimento;
  return opcao.meses ? somarMeses(base, opcao.meses) : somarDias(base, opcao.dias);
}

// ---------- repetição ----------

export const RECORRENCIAS = [
  { id: 'semanal', rotulo: 'Toda semana' },
  { id: 'mensal', rotulo: 'Todo mês' },
  { id: 'anual', rotulo: 'Todo ano' },
];

/**
 * Próxima data de uma tarefa que repete. `diaOriginal` evita que "dia 31" vire "dia 28"
 * para sempre depois de fevereiro.
 */
export function proximaData(vencimento, recorrencia, diaOriginal) {
  if (!vencimento) return null;
  if (recorrencia === 'semanal') return somarDias(vencimento, 7);
  const meses = { mensal: 1, anual: 12 }[recorrencia];
  if (!meses) return null;
  const proxima = somarMeses(vencimento, meses);
  if (!diaOriginal) return proxima;
  // somarMeses já limita ao último dia; aqui volta para o dia original quando o mês permite.
  const [a, m] = proxima.split('-');
  const ultimo = new Date(Date.UTC(Number(a), Number(m), 0)).getUTCDate();
  return `${a}-${m}-${String(Math.min(diaOriginal, ultimo)).padStart(2, '0')}`;
}

/** A tarefa que nasce quando uma tarefa que repete é concluída. */
export function proximaOcorrencia(tarefa) {
  const vencimento = proximaData(tarefa.vencimento, tarefa.recorrencia, tarefa.dia_original);
  if (!vencimento) return null;
  return {
    titulo: tarefa.titulo,
    notas: tarefa.notas ?? null,
    categoria_id: tarefa.categoria_id ?? null,
    hora: normalizarHora(tarefa.hora),
    recorrencia: tarefa.recorrencia,
    dia_original: tarefa.dia_original ?? Number(tarefa.vencimento.slice(8, 10)),
    vencimento,
    gerado_de: tarefa.id,
  };
}

// ---------- avisos ----------

/**
 * Qual aviso do dia enviar para a tarefa, ou null.
 * 'entrou' (entrou em Vencendo), 'vespera', 'hoje', 'atrasada' (dia seguinte ao vencimento).
 * Avisos já enviados (lista `avisos_enviados`) não se repetem.
 */
export function etapaAviso(tarefa, avisoDias, hoje) {
  if (tarefa.concluida_em || !tarefa.vencimento) return null;
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
  const as = tarefa.hora ? ` às ${horaCurta(tarefa.hora)}` : '';
  switch (etapa) {
    case 'entrou':
      return { titulo: 'Vencendo em breve', corpo: `${tarefa.titulo} vence em ${diaCurto(tarefa.vencimento)}.` };
    case 'vespera':
      return { titulo: `Vence amanhã${as}`, corpo: tarefa.titulo };
    case 'hoje':
      return { titulo: `Vence hoje${as}`, corpo: tarefa.titulo };
    case 'atrasada':
      return { titulo: 'Venceu ontem', corpo: `${tarefa.titulo} ainda não foi concluída.` };
    default:
      return null;
  }
}

/** Minutos que faltam até o horário da tarefa (negativo se já passou), ou null sem data/horário. */
export function minutosAte(tarefa, hoje, minutosAgora) {
  if (!tarefa.vencimento || !normalizarHora(tarefa.hora)) return null;
  return diasEntre(hoje, tarefa.vencimento) * 1440 + minutosDe(tarefa.hora) - minutosAgora;
}

/**
 * Lembrete de tarefa com horário: 'h3' (3 horas antes), 'h1' (1 hora antes), 'm10' (10 minutos antes).
 * Manda o da faixa em que está agora, se ainda não mandou. Depois do horário, nada.
 */
export function etapaLembrete(tarefa, hoje, minutosAgora) {
  if (tarefa.concluida_em) return null;
  const falta = minutosAte(tarefa, hoje, minutosAgora);
  if (falta === null || falta < 0) return null;
  const etapa = falta <= 10 ? 'm10' : falta <= 60 ? 'h1' : falta <= 180 ? 'h3' : null;
  const enviados = tarefa.avisos_enviados || [];
  return etapa && !enviados.includes(etapa) ? etapa : null;
}

export function textoLembrete(etapa, tarefa) {
  const quando = { h3: 'Em 3 horas', h1: 'Em 1 hora', m10: 'Em 10 minutos' }[etapa];
  return quando ? { titulo: `${quando}: ${tarefa.titulo}`, corpo: `Às ${horaCurta(tarefa.hora)}.` } : null;
}
