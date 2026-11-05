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
 * Resumo do mês: quanto entrou, quanto saiu, quanto resta e quanto dá para gastar por dia.
 *
 * Crédito e à vista contam igual no orçamento do mês. A diferença é quando o dinheiro sai:
 * `saldo` é o que ainda está no salário agora (renda − à vista); `faturas` soma só o crédito, por cartão.
 *
 * O "por dia" é calculado com o que sobrou até ontem, dividido pelos dias que faltam
 * (contando hoje). Assim, uma compra feita hoje não muda o limite de hoje: ela reduz o
 * "resta hoje". Nos meses que já passaram não há limite diário.
 */
export function resumoMes({ renda, gastos, mes, hoje, timeZone }) {
  const rendaC = centavos(Number(renda) || 0);
  const mesAtual = chaveMes(hoje);
  let gastoC = 0;
  let gastoHojeC = 0;
  let avistaC = 0;
  const cartoes = new Map();
  const faturas = new Map();
  const doMes = [];

  for (const g of gastos) {
    const dia = diaDoGasto(g, timeZone);
    if (chaveMes(dia) !== mes) continue;
    const v = centavos(Number(g.valor));
    gastoC += v;
    if (dia === hoje) gastoHojeC += v;
    const nome = g.cartao || 'Sem cartão';
    const c = cartoes.get(nome) || { cartao: nome, totalC: 0, quantidade: 0 };
    c.totalC += v;
    c.quantidade += 1;
    cartoes.set(nome, c);
    if (formaDe(g) === 'avista') avistaC += v;
    else {
      const f = faturas.get(nome) || { cartao: nome, totalC: 0, quantidade: 0 };
      f.totalC += v;
      f.quantidade += 1;
      faturas.set(nome, f);
    }
    doMes.push({ ...g, dia, forma: formaDe(g) });
  }

  let diasRestantes;
  if (mes < mesAtual) diasRestantes = 0;
  else if (mes > mesAtual) diasRestantes = diasNoMes(mes);
  else diasRestantes = diasNoMes(mes) - Number(hoje.slice(8, 10)) + 1;

  const restaC = rendaC - gastoC;
  let porDia = null;
  let restaHoje = null;
  if (diasRestantes > 0 && rendaC > 0) {
    const ateOntemC = rendaC - (gastoC - gastoHojeC);
    const porDiaC = Math.max(0, Math.floor(ateOntemC / diasRestantes));
    porDia = reais(porDiaC);
    restaHoje = mes === mesAtual ? reais(porDiaC - gastoHojeC) : porDia;
  }

  return {
    mes,
    renda: reais(rendaC),
    gasto: reais(gastoC),
    resta: reais(restaC),
    gastoHoje: reais(gastoHojeC),
    credito: reais(gastoC - avistaC),
    avista: reais(avistaC),
    saldo: reais(rendaC - avistaC),
    diasRestantes,
    porDia,
    restaHoje,
    percentual: rendaC > 0 ? gastoC / rendaC : null,
    porCartao: [...cartoes.values()]
      .sort((a, b) => b.totalC - a.totalC)
      .map(({ cartao, totalC, quantidade }) => ({ cartao, total: reais(totalC), quantidade })),
    faturas: [...faturas.values()]
      .sort((a, b) => b.totalC - a.totalC)
      .map(({ cartao, totalC, quantidade }) => ({ cartao, total: reais(totalC), quantidade })),
    gastos: doMes.sort((a, b) => String(b.data).localeCompare(String(a.data))),
  };
}

/** Normaliza o nome do cartão vindo da Carteira ('  Nubank   Ultravioleta ' → 'Nubank Ultravioleta'). */
export function nomeCartao(nome) {
  const s = String(nome || '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 60) : null;
}
