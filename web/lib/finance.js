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
 * Tipo do lançamento, pelo sinal do valor:
 *  - 'gasto'   valor positivo;
 *  - 'entrada' valor negativo à vista: dinheiro que entrou (freela, Pix recebido, reembolso);
 *  - 'estorno' valor negativo no crédito: devolução na fatura do cartão.
 */
export function tipoDe(g) {
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
 *  - gasto:   gastos do mês menos estornos no cartão;
 *  - entradas: dinheiro que entrou além da renda;
 *  - resta:   renda + entradas − gasto.
 *
 * Crédito e à vista contam igual no orçamento do mês. A diferença é quando o dinheiro sai:
 * `saldo` é o que ainda está no salário agora (renda + entradas − à vista); `faturas` soma só o
 * crédito, por cartão.
 *
 * O "por dia" é o que sobrou até ontem (com todas as entradas do mês) dividido pelos dias que faltam
 * (contando hoje). Assim, uma compra feita hoje não muda o limite de hoje: ela reduz o "resta hoje";
 * e uma entrada se espalha pelos dias que faltam. Nos meses que já passaram não há limite diário.
 */
export function resumoMes({ renda, gastos, mes, hoje, timeZone }) {
  const rendaC = centavos(Number(renda) || 0);
  const mesAtual = chaveMes(hoje);
  let gastoC = 0; // gastos − estornos
  let gastoHojeC = 0;
  let entradasC = 0;
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
    } else {
      gastoC += v;
      if (dia === hoje) gastoHojeC += v;
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

  const disponivelC = rendaC + entradasC;
  const restaC = disponivelC - gastoC;
  let porDia = null;
  let restaHoje = null;
  if (diasRestantes > 0 && disponivelC > 0) {
    const ateOntemC = disponivelC - (gastoC - gastoHojeC);
    const porDiaC = Math.max(0, Math.floor(ateOntemC / diasRestantes));
    porDia = reais(porDiaC);
    restaHoje = mes === mesAtual ? reais(porDiaC - gastoHojeC) : porDia;
  }

  const listar = (mapa) => [...mapa.values()]
    .filter((x) => x.totalC !== 0)
    .sort((a, b) => b.totalC - a.totalC)
    .map(({ cartao, totalC, quantidade }) => ({ cartao, total: reais(totalC), quantidade }));

  return {
    mes,
    renda: reais(rendaC),
    entradas: reais(entradasC),
    disponivel: reais(disponivelC),
    gasto: reais(gastoC),
    resta: reais(restaC),
    gastoHoje: reais(gastoHojeC),
    credito: reais(creditoC),
    avista: reais(avistaC),
    saldo: reais(disponivelC - avistaC),
    diasRestantes,
    porDia,
    restaHoje,
    percentual: disponivelC > 0 ? gastoC / disponivelC : null,
    porCartao: listar(cartoes),
    faturas: listar(faturas),
    gastos: doMes.sort((a, b) => String(b.data).localeCompare(String(a.data))),
  };
}

/** Normaliza o nome do cartão vindo da Carteira ('  Nubank   Ultravioleta ' → 'Nubank Ultravioleta'). */
export function nomeCartao(nome) {
  const s = String(nome || '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 60) : null;
}
