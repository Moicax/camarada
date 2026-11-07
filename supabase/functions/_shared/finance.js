import { chaveMes, diasNoMes, diaLocal } from './dates.js';

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
  let investidoC = 0;
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
    } else {
      gastoC += v;
      // Pagamento de conta ("Paguei"): o dinheiro já estava separado do mês, então não come o
      // limite de hoje (conta como se já tivesse saído antes).
      if (dia === hoje && !g.tarefa_id) gastoHojeC += v;
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
    investido: reais(investidoC),
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
      investido: reais(investidoC),
      falta: reais(Math.max(0, metaInvC - investidoC)),
      pct: investidoC / metaInvC,
      atingida: investidoC >= metaInvC,
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
