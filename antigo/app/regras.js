// Regras de prazo do Camarada. Usado pelo app e pelo servidor.
// Datas de prazo são texto "AAAA-MM-DD": dia de calendário, sem hora, para nada vencer um dia antes por causa do fuso.

const DIA = 864e5;

export const ABAS = ['pendentes', 'expirar', 'feitas'];
export const NOME_ABA = { pendentes: 'Pendentes', expirar: 'A expirar', feitas: 'Concluídas' };

export const diaNum = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DIA); };
export const isoDe = n => new Date(n * DIA).toISOString().slice(0, 10);
export const somarDias = (iso, k) => isoDe(diaNum(iso) + k);
export const diasAte = (iso, hoje) => diaNum(iso) - diaNum(hoje);
export const curta = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);

// Sem fuso usa o relógio do aparelho; o servidor passa 'America/Sao_Paulo'.
export function hojeIso(agora = new Date(), fuso) {
  if (fuso) return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
  return isoDe(Math.round(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()) / DIA));
}

// Próxima ocorrência de um item que repete. diaOriginal evita que "dia 31" vire "dia 28" para sempre depois de fevereiro.
export function proximaData(iso, recorrencia, diaOriginal) {
  if (recorrencia === 'semanal') return somarDias(iso, 7);
  const meses = recorrencia === 'mensal' ? 1 : recorrencia === 'anual' ? 12 : 0;
  if (!meses) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m - 1 + meses + 1, 0)).getUTCDate();
  return isoDe(Math.round(Date.UTC(y, m - 1 + meses, Math.min(diaOriginal || d, ultimo)) / DIA));
}

// Quantos dias antes do prazo o item entra em A expirar: o do item, senão o da categoria, senão o padrão.
export function avisoDe(item, categorias, padrao) {
  if (Number.isInteger(item.aviso_dias)) return item.aviso_dias;
  const cat = categorias.find(c => c.id === item.categoria_id && !c.apagado);
  return cat ? cat.aviso_dias : padrao;
}

export function abaDe(item, hoje, categorias, padrao) {
  if (item.concluido_em) return 'feitas';
  if (!item.data_limite) return 'pendentes';
  return diasAte(item.data_limite, hoje) <= avisoDe(item, categorias, padrao) ? 'expirar' : 'pendentes';
}

export function separar(itens, hoje, categorias, padrao) {
  const g = { pendentes: [], expirar: [], feitas: [] };
  for (const it of itens) if (!it.apagado) g[abaDe(it, hoje, categorias, padrao)].push(it);
  // no mesmo dia, a que tem hora mais cedo vem antes; sem hora fica no fim do dia
  const prazo = i => (i.data_limite || '9999-12-31') + (i.hora || '24:00');
  const porData = (a, b) => prazo(a).localeCompare(prazo(b)) || (a.criado_em || '').localeCompare(b.criado_em || '');
  g.pendentes.sort(porData);
  g.expirar.sort(porData);
  g.feitas.sort((a, b) => b.concluido_em.localeCompare(a.concluido_em) || (b.atualizado_em || '').localeCompare(a.atualizado_em || ''));
  return g;
}

/* ---------- finanças (valores sempre em centavos, inteiros) ---------- */

// Entende "R$ 1.234,56", "1234.56", "12,5", "R$ 10" e o número puro que o Atalhos do iPhone pode mandar.
export function valorEmCentavos(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(Math.abs(v) * 100) : null;
  const s = String(v ?? '').replace(/[^\d,.]/g, '');
  if (!/\d/.test(s)) return null;
  const virgula = s.lastIndexOf(',');
  const ponto = s.lastIndexOf('.');
  const pos = Math.max(virgula, ponto);
  // só é separador de centavos se vier com 1 ou 2 dígitos depois (em "1.234", o ponto é de milhar)
  const decimal = pos >= 0 && s.length - pos - 1 >= 1 && s.length - pos - 1 <= 2;
  const inteiros = (decimal ? s.slice(0, pos) : s).replace(/\D/g, '') || '0';
  const centavos = decimal ? (s.slice(pos + 1) + '0').slice(0, 2) : '00';
  const total = Number(inteiros) * 100 + Number(centavos);
  return Number.isSafeInteger(total) ? total : null;
}

const MOEDA = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const reais = c => (c < 0 ? '−' : '') + 'R$ ' + MOEDA.format(Math.abs(c) / 100);

// Cartões marcados como débito em Ajustes: compra com eles sai do salário na hora.
const nomeCartao = s => String(s || '').trim().toLowerCase();
export const cartaoNaLista = (cartao, lista) => Boolean(cartao) && (lista || []).some(c => nomeCartao(c) === nomeCartao(cartao));

// Total do mês, quanto sobra da renda, quanto dá para gastar por dia e a fatura de cada cartão.
export function resumoDoMes(gastos, mes, renda, hoje) {
  const doMes = gastos.filter(g => !g.apagado && g.data && g.data.slice(0, 7) === mes);
  const total = doMes.reduce((s, g) => s + g.valor, 0);
  // Crédito vai para a fatura do cartão; à vista (débito, Pix, dinheiro) sai do salário na hora.
  const doCredito = doMes.filter(g => (g.forma || 'credito') === 'credito');
  const credito = doCredito.reduce((s, g) => s + g.valor, 0);
  const avista = total - credito;
  // Faturas: só o que foi no crédito, separado por cartão.
  const cartoes = new Map();
  for (const g of doCredito) {
    const nome = g.cartao || 'Sem cartão';
    const c = cartoes.get(nome) || { cartao: nome, total: 0, qtd: 0 };
    c.total += g.valor;
    c.qtd += 1;
    cartoes.set(nome, c);
  }
  const saldo = renda - avista;
  const sobra = renda - total;
  let diasRestantes = null;
  let porDia = null;
  if (hoje.slice(0, 7) === mes) {
    const [y, m] = mes.split('-').map(Number);
    diasRestantes = new Date(Date.UTC(y, m, 0)).getUTCDate() - Number(hoje.slice(8)) + 1;
    porDia = sobra > 0 ? Math.floor(sobra / diasRestantes) : 0;
  }
  return { doMes, total, credito, avista, saldo, sobra, diasRestantes, porDia, porCartao: [...cartoes.values()].sort((a, b) => b.total - a.total) };
}

// Laranja só quando falta pouco. Mais longe que isso, a tarefa pode estar em A expirar, mas sem alarme.
export const URGENTE_DIAS = 7;

// Hora opcional do prazo, "HH:MM". No texto fica do jeito falado: 18:00 → 18h, 09:30 → 9h30.
export const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
export const horaCurta = h => h.replace(/^0(?=\d)/, '').replace(':00', 'h').replace(':', 'h');

// Texto e tom do prazo: '' neutro, 'warn' laranja, 'late' vermelho, 'ok' feito. Sem data: texto vazio.
export function prazoTexto(item, hoje, aviso) {
  if (item.concluido_em) return { texto: 'feito ' + curta(item.concluido_em), tom: 'ok' };
  if (!item.data_limite) return { texto: '', tom: '' };
  const d = diasAte(item.data_limite, hoje);
  const as = item.hora ? ' às ' + horaCurta(item.hora) : '';
  if (d < 0) return { texto: d === -1 ? 'venceu ontem' : `venceu há ${-d} dias`, tom: 'late' };
  if (d === 0) return { texto: 'vence hoje' + as, tom: 'late' };
  const tom = d <= aviso && d <= URGENTE_DIAS ? 'warn' : '';
  if (d === 1) return { texto: 'vence amanhã' + as, tom };
  return d <= aviso ? { texto: `vence em ${d} dias`, tom } : { texto: 'até ' + curta(item.data_limite), tom };
}
