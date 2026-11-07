import { chaveMes, diasNoMes, diaLocal, diasEntre, somarDias, inicioDaSemana, segundasNoMes as segundas } from './dates.js';

const centavos = (n) => Math.round(n * 100);
const reais = (c) => c / 100;

/**
 * Lê um valor em dinheiro vindo do app ou do Atalho do iPhone.
 * Aceita 23.9, '23,90', 'R$ 1.234,56', '1,234.56', 'BRL 23.90', '-R$ 5,00'.
 * Devolve NaN se não entender.
 */
export function lerValor(entrada) {
  if (typeof entrada === 'number') return Number.isFinite(entrada) ? reais(centavos(entrada)) : NaN;
  if (typeof entrada !== 'string') return NaN;
  let s = entrada.trim().replace(/\s/g, '');
  const negativo = s.includes('-') || /^\(.*\)$/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return NaN;
  const ultVirgula = s.lastIndexOf(',');
  const ultPonto = s.lastIndexOf('.');
  let decimal = null;
  if (ultVirgula >= 0 && ultPonto >= 0) decimal = ultVirgula > ultPonto ? ',' : '.';
  else if (ultVirgula >= 0) decimal = s.length - ultVirgula - 1 <= 2 ? ',' : null;
  else if (ultPonto >= 0) {
    // '1.234' é milhar; '12.5' e '12.50' são decimais; '1.234.567' é milhar.
    const unico = s.indexOf('.') === ultPonto;
    decimal = unico && s.length - ultPonto - 1 <= 2 ? '.' : null;
  }
  let inteiro = s;
  let fracao = '';
  if (decimal) {
    const i = s.lastIndexOf(decimal);
    inteiro = s.slice(0, i);
    fracao = s.slice(i + 1);
  }
  inteiro = inteiro.replace(/[.,]/g, '') || '0';
  const n = Number(`${inteiro}.${fracao || '0'}`);
  if (!Number.isFinite(n)) return NaN;
  return reais(centavos(negativo ? -n : n));
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatarReal(n) {
  return BRL.format(n).replace(/ /g, ' ');
}

/** Dia (AAAA-MM-DD) de um gasto. */
export function diaDoGasto(gasto, timeZone) {
  return gasto.dia || diaLocal(new Date(gasto.data), timeZone);
}

/** Como o gasto foi pago: no crédito vai para a fatura; à vista (débito, Pix, dinheiro) sai do salário na hora. */
export const FORMAS = [
  { id: 'credito', rotulo: 'Crédito' },
  { id: 'avista', rotulo: 'À vista' },
];
export const formaDe = (gasto) => (gasto.forma === 'avista' ? 'avista' : 'credito');

/**
 * Tipo do lançamento:
 *  - 'investimento' dinheiro guardado/investido no mês (sai do que dá para gastar, mas não é gasto);
 *  - 'resgate'      investimento com valor negativo: dinheiro que voltou do investimento;
 *  - 'gasto'        valor positivo;
 *  - 'entrada'      valor negativo à vista: dinheiro que entrou (freela, Pix recebido, reembolso);
 *  - 'estorno'      valor negativo no crédito: devolução na fatura do cartão.
 */
export function tipoDe(g) {
  if (g.investimento) return Number(g.valor) >= 0 ? 'investimento' : 'resgate';
  if (Number(g.valor) >= 0) return 'gasto';
  return formaDe(g) === 'avista' ? 'entrada' : 'estorno';
}

/**
 * Resumo do mês: quanto entrou, quanto saiu, quanto resta e quanto dá para gastar por dia.
 *
 * Tudo é recalculado a partir da lista de lançamentos, em centavos inteiros: não existe saldo
 * guardado que vai sendo somado e subtraído. Por isso apagar um lançamento devolve exatamente
 * o valor dele, e editar muda só a diferença.
 *
 *  - gasto:      gastos do mês menos estornos no cartão (investimento não é gasto);
 *  - entradas:   dinheiro que entrou além da renda;
 *  - investido:  aplicado no mês (menos resgates);
 *  - disponivel: renda + entradas − investido (o que há para gastar no mês);
 *  - resta:      disponivel − gasto.
 *
 * Metas (opcionais): `metaGasto` é o máximo para gastar no mês (alerta aos 80% e aos 100%);
 * `metaInvestimento` é quanto a pessoa quer investir no mês.
 *
 * Crédito e à vista contam igual no orçamento do mês. A diferença é quando o dinheiro sai:
 * `saldo` é o que ainda está no salário agora (renda + entradas − à vista); `faturas` soma só o
 * crédito, por cartão.
 *
 * O "por dia" é o que sobrou até ontem (com todas as entradas do mês) dividido pelos dias que faltam
 * (contando hoje). Assim, uma compra feita hoje não muda o limite de hoje: ela reduz o "resta hoje";
 * e uma entrada se espalha pelos dias que faltam. Nos meses que já passaram não há limite diário.
 */
/** Gasto feito com dinheiro que já estava separado: pagamento de conta ou uso de um objetivo. */
const separadoAntes = (g) => Boolean(g.tarefa_id || g.objetivo_id);

export function resumoMes({ renda, gastos, mes, hoje, timeZone, metaGasto = 0, metaInvestimento = 0, compromissos = [] }) {
  const rendaC = centavos(Number(renda) || 0);
  const mesAtual = chaveMes(hoje);
  // Contas a pagar do mês (tarefas com valor, ainda abertas): o dinheiro já tem dono, então sai
  // do que dá para gastar antes mesmo de vencer. Mês que já passou não tem conta "a pagar".
  const contas = mes < mesAtual ? [] : compromissos;
  const comprometidoC = contas.reduce((t, c) => t + centavos(Number(c.valor) || 0), 0);
  let gastoC = 0; // gastos − estornos
  let gastoHojeC = 0;
  let entradasC = 0;
  let investidoC = 0; // tudo o que saiu do que dá para gastar sem ser gasto (investimentos e objetivos)
  let investidoMetaC = 0; // só investimentos (o guardado para objetivos aparece nos objetivos)
  let avistaC = 0; // gastos à vista
  let creditoC = 0; // gastos no crédito − estornos
  const cartoes = new Map();
  const faturas = new Map();
  const doMes = [];

  for (const g of gastos) {
    const dia = diaDoGasto(g, timeZone);
    if (chaveMes(dia) !== mes) continue;
    const v = centavos(Number(g.valor));
    const tipo = tipoDe(g);
    const nome = g.cartao || 'Sem cartão';
    if (tipo === 'entrada') {
      entradasC += -v;
    } else if (tipo === 'investimento' || tipo === 'resgate') {
      investidoC += v;
      if (!g.objetivo_id) investidoMetaC += v;
    } else {
      gastoC += v;
      // Pagamento de conta ("Paguei") ou compra com o dinheiro de um objetivo: o dinheiro já estava
      // separado, então não come o limite de hoje (conta como se já tivesse saído antes).
      if (dia === hoje && !separadoAntes(g)) gastoHojeC += v;
      const c = cartoes.get(nome) || { cartao: nome, totalC: 0, quantidade: 0 };
      c.totalC += v;
      c.quantidade += 1;
      cartoes.set(nome, c);
      if (formaDe(g) === 'avista') avistaC += v;
      else {
        creditoC += v;
        const f = faturas.get(nome) || { cartao: nome, totalC: 0, quantidade: 0 };
        f.totalC += v;
        f.quantidade += 1;
        faturas.set(nome, f);
      }
    }
    doMes.push({ ...g, dia, forma: formaDe(g), tipo });
  }

  let diasRestantes;
  if (mes < mesAtual) diasRestantes = 0;
  else if (mes > mesAtual) diasRestantes = diasNoMes(mes);
  else diasRestantes = diasNoMes(mes) - Number(hoje.slice(8, 10)) + 1;

  const disponivelC = rendaC + entradasC - investidoC - comprometidoC;
  const restaC = disponivelC - gastoC;
  let porDia = null;
  let restaHoje = null;
  // Com renda (ou entradas) no mês, sempre há um limite do dia, mesmo que seja zero: as contas
  // ou o investido podem ter levado tudo, e aí o Camarada diz "hoje dá R$ 0", não some o número.
  if (diasRestantes > 0 && (disponivelC > 0 || (rendaC + entradasC > 0 && (comprometidoC > 0 || investidoC > 0)))) {
    const ateOntemC = disponivelC - (gastoC - gastoHojeC);
    const porDiaC = Math.max(0, Math.floor(ateOntemC / diasRestantes));
    porDia = reais(porDiaC);
    restaHoje = mes === mesAtual ? reais(porDiaC - gastoHojeC) : porDia;
  }

  const listar = (mapa) => [...mapa.values()]
    .filter((x) => x.totalC !== 0)
    .sort((a, b) => b.totalC - a.totalC)
    .map(({ cartao, totalC, quantidade }) => ({ cartao, total: reais(totalC), quantidade }));

  const metaGastoC = centavos(Number(metaGasto) || 0);
  const metaInvC = centavos(Number(metaInvestimento) || 0);
  const pctGasto = metaGastoC > 0 ? gastoC / metaGastoC : null;

  return {
    mes,
    renda: reais(rendaC),
    entradas: reais(entradasC),
    investido: reais(investidoMetaC),
    guardadoObjetivos: reais(investidoC - investidoMetaC),
    disponivel: reais(disponivelC),
    gasto: reais(gastoC),
    resta: reais(restaC),
    gastoHoje: reais(gastoHojeC),
    credito: reais(creditoC),
    avista: reais(avistaC),
    saldo: reais(rendaC + entradasC - investidoC - avistaC), // no salário agora: o investido já saiu (as contas ainda não)
    comprometido: reais(comprometidoC),
    compromissos: contas,
    diasRestantes,
    porDia,
    restaHoje,
    percentual: disponivelC > 0 ? gastoC / disponivelC : null,
    porCartao: listar(cartoes),
    faturas: listar(faturas),
    metaGasto: metaGastoC > 0 ? {
      meta: reais(metaGastoC),
      usado: reais(gastoC),
      falta: reais(metaGastoC - gastoC),
      pct: pctGasto,
      nivel: nivelMeta(pctGasto),
    } : null,
    metaInvestimento: metaInvC > 0 ? {
      meta: reais(metaInvC),
      investido: reais(investidoMetaC),
      falta: reais(Math.max(0, metaInvC - investidoMetaC)),
      pct: investidoMetaC / metaInvC,
      atingida: investidoMetaC >= metaInvC,
    } : null,
    gastos: doMes.sort((a, b) => String(b.data).localeCompare(String(a.data))),
  };
}

/**
 * Contas a pagar de um mês: tarefas abertas, com valor e com vencimento até o fim do mês.
 * No mês atual entram também as atrasadas (ainda não pagas, ainda vão sair do bolso); num mês
 * futuro, só as que vencem nele; num mês que já passou, nenhuma. Tarefa sem data não entra.
 */
export function compromissosDoMes(tarefas, mes, hoje) {
  const mesAtual = chaveMes(hoje);
  if (mes < mesAtual) return [];
  const inicio = mes === mesAtual ? '' : `${mes}-01`;
  const fim = `${mes}-${String(diasNoMes(mes)).padStart(2, '0')}`;
  return (tarefas ?? [])
    .filter((t) => !t.concluida_em && t.vencimento && Number(t.valor) > 0 && t.vencimento >= inicio && t.vencimento <= fim)
    .map((t) => ({ id: t.id, titulo: t.titulo, vencimento: t.vencimento, valor: reais(centavos(Number(t.valor))) }))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || String(a.titulo).localeCompare(String(b.titulo), 'pt-BR'));
}

/**
 * Contas a pagar até um dia (inclusive): tarefas abertas, com valor e vencimento até `ate`
 * (as atrasadas entram). Usado no limite da semana.
 */
export function compromissosAte(tarefas, ate) {
  return (tarefas ?? [])
    .filter((t) => !t.concluida_em && t.vencimento && Number(t.valor) > 0 && t.vencimento <= ate)
    .map((t) => ({ id: t.id, titulo: t.titulo, vencimento: t.vencimento, valor: reais(centavos(Number(t.valor))) }))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || String(a.titulo).localeCompare(String(b.titulo), 'pt-BR'));
}

/** Início e fim do período do limite (mês, ou semana de segunda a domingo) que contém `hoje`. */
export function periodoDe(hoje, periodo = 'mes') {
  if (periodo === 'semana') {
    const inicio = inicioDaSemana(hoje);
    return { inicio, fim: somarDias(inicio, 6) };
  }
  const mes = chaveMes(hoje);
  return { inicio: `${mes}-01`, fim: `${mes}-${String(diasNoMes(mes)).padStart(2, '0')}` };
}

/**
 * Objetivos ("Juntar para…"): quanto já foi guardado e quanto o Camarada separa neste período.
 *
 * A cota do período é o que faltava no começo dele dividido pelos períodos que faltam até a data
 * (contando este). Guardar de verdade ("Guardei") abate a reserva: o guardado sai do que dá para
 * gastar e a reserva cai na mesma medida, sem contar duas vezes.
 * `movimentos`: lançamentos de investimento ligados a objetivos ({ objetivo_id, valor, data | dia });
 * valor negativo é dinheiro tirado do objetivo.
 */
export function situacaoDosObjetivos({ objetivos, movimentos = [], hoje, periodo = 'mes', timeZone }) {
  const { inicio, fim } = periodoDe(hoje, periodo);
  const porObjetivo = new Map();
  for (const m of movimentos) {
    if (!m.objetivo_id || m.investimento === false) continue;
    const dia = diaDoGasto(m, timeZone);
    const x = porObjetivo.get(m.objetivo_id) || { totalC: 0, antesC: 0, noPeriodoC: 0 };
    const v = centavos(Number(m.valor) || 0);
    x.totalC += v;
    if (dia < inicio) x.antesC += v;
    else if (dia <= fim) x.noPeriodoC += v;
    porObjetivo.set(m.objetivo_id, x);
  }
  return (objetivos ?? []).filter((o) => !o.concluido_em).map((o) => {
    const alvoC = centavos(Number(o.valor_alvo) || 0);
    const { totalC, antesC, noPeriodoC } = porObjetivo.get(o.id) || { totalC: 0, antesC: 0, noPeriodoC: 0 };
    const atingido = alvoC > 0 && totalC >= alvoC;
    const prazoPassou = !atingido && o.data_alvo < hoje;
    let unidades;
    if (periodo === 'semana') unidades = Math.floor(diasEntre(inicioDaSemana(hoje), inicioDaSemana(o.data_alvo)) / 7) + 1;
    else {
      const [a1, m1] = chaveMes(hoje).split('-').map(Number);
      const [a2, m2] = chaveMes(o.data_alvo).split('-').map(Number);
      unidades = (a2 * 12 + m2) - (a1 * 12 + m1) + 1;
    }
    let cotaC = 0;
    if (!atingido && !prazoPassou && unidades > 0) cotaC = Math.ceil(Math.max(0, alvoC - antesC) / unidades);
    const reservadoC = Math.max(0, Math.min(cotaC - noPeriodoC, alvoC - totalC));
    return {
      id: o.id,
      titulo: o.titulo,
      alvo: reais(alvoC),
      dataAlvo: o.data_alvo,
      guardado: reais(totalC),
      falta: reais(Math.max(0, alvoC - totalC)),
      pct: alvoC > 0 ? Math.min(1, Math.max(0, totalC / alvoC)) : 0,
      atingido,
      prazoPassou,
      periodo,
      cota: reais(cotaC),
      guardadoNoPeriodo: reais(noPeriodoC),
      reservado: reais(reservadoC),
      fimDoPeriodo: fim,
    };
  });
}

/** A reserva dos objetivos neste período, no mesmo formato das contas a pagar. */
export function compromissosDosObjetivos(args) {
  return situacaoDosObjetivos(args)
    .filter((o) => o.reservado > 0)
    .map((o) => ({
      id: `objetivo:${o.id}`, objetivoId: o.id, objetivo: true, titulo: `Guardar para ${o.titulo}`, vencimento: o.fimDoPeriodo, valor: o.reservado,
    }));
}

/**
 * Resumo da semana (segunda a domingo), para quem recebe por semana (mesada, por exemplo): o
 * limite do dia é o que resta na semana dividido pelos dias que faltam dela. Mesmas regras do mês:
 * entradas somam; investimentos, contas a pagar e objetivos já saem antes.
 */
export function resumoSemana({ rendaSemanal = 0, gastos, hoje, timeZone, compromissos = [] }) {
  const { inicio, fim } = periodoDe(hoje, 'semana');
  const rendaC = centavos(Number(rendaSemanal) || 0);
  const comprometidoC = compromissos.reduce((t, c) => t + centavos(Number(c.valor) || 0), 0);
  let gastoC = 0;
  let gastoHojeC = 0;
  let entradasC = 0;
  let investidoC = 0;
  for (const g of gastos) {
    const dia = diaDoGasto(g, timeZone);
    if (dia < inicio || dia > fim) continue;
    const v = centavos(Number(g.valor));
    const tipo = tipoDe(g);
    if (tipo === 'entrada') entradasC += -v;
    else if (tipo === 'investimento' || tipo === 'resgate') investidoC += v;
    else {
      gastoC += v;
      if (dia === hoje && !separadoAntes(g)) gastoHojeC += v;
    }
  }
  const diasRestantes = diasEntre(hoje, fim) + 1;
  const disponivelC = rendaC + entradasC - investidoC - comprometidoC;
  let porDia = null;
  let restaHoje = null;
  if (disponivelC > 0 || (rendaC + entradasC > 0 && (comprometidoC > 0 || investidoC > 0))) {
    const porDiaC = Math.max(0, Math.floor((disponivelC - (gastoC - gastoHojeC)) / diasRestantes));
    porDia = reais(porDiaC);
    restaHoje = reais(porDiaC - gastoHojeC);
  }
  return {
    periodo: 'semana',
    inicio,
    fim,
    renda: reais(rendaC),
    entradas: reais(entradasC),
    investido: reais(investidoC),
    gasto: reais(gastoC),
    gastoHoje: reais(gastoHojeC),
    comprometido: reais(comprometidoC),
    compromissos,
    disponivel: reais(disponivelC),
    resta: reais(disponivelC - gastoC),
    diasRestantes,
    porDia,
    restaHoje,
  };
}

/** Renda de um mês conforme o jeito de receber: salário fixo, mesada por semana ou o que entrar. */
export function rendaDoMes({ tipoRenda = 'mensal', renda = 0, rendaSemanal = 0, mes }) {
  if (tipoRenda === 'semanal') return reais(centavos(Number(rendaSemanal) || 0) * segundas(mes));
  if (tipoRenda === 'variavel') return 0;
  return Number(renda) || 0;
}

/**
 * O número do dia ("hoje ainda dá para gastar"), igual no app, no bom dia e na notificação de
 * compra. Salário fixo e renda variável usam o mês (a variável conta só o que já entrou); mesada
 * usa a semana. Contas a pagar e objetivos já saem antes.
 */
export function numeroDoDia({
  tipoRenda = 'mensal', renda = 0, rendaSemanal = 0, gastos = [], tarefas = [], objetivos = [], movimentos = [], hoje, timeZone,
}) {
  if (tipoRenda === 'semanal') {
    const { fim } = periodoDe(hoje, 'semana');
    const compromissos = [
      ...compromissosAte(tarefas, fim),
      ...compromissosDosObjetivos({ objetivos, movimentos, hoje, periodo: 'semana', timeZone }),
    ];
    return resumoSemana({ rendaSemanal, gastos, hoje, timeZone, compromissos });
  }
  const mes = chaveMes(hoje);
  const compromissos = [
    ...compromissosDoMes(tarefas, mes, hoje),
    ...compromissosDosObjetivos({ objetivos, movimentos, hoje, periodo: 'mes', timeZone }),
  ];
  return { periodo: 'mes', ...resumoMes({ renda: rendaDoMes({ tipoRenda, renda, mes }), gastos, mes, hoje, timeZone, compromissos }) };
}

/** Nível de alerta da meta de gastos: 100 (passou ou chegou), 80 (quase lá) ou null. */
export function nivelMeta(pct) {
  if (pct === null || pct === undefined) return null;
  if (pct >= 1) return 100;
  if (pct >= 0.8) return 80;
  return null;
}

/** Normaliza o nome do cartão vindo da Carteira ('  Nubank   Ultravioleta ' → 'Nubank Ultravioleta'). */
export function nomeCartao(nome) {
  const s = String(nome || '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 60) : null;
}
