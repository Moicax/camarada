import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  diasEntre, somarDias, somarMeses, diasNoMes, mudarMes, nomeMes, rotuloDia, diaLocal,
} from '../web/lib/dates.js';
import {
  classificar, separar, rotuloPrazo, adiar, etapaAviso, textoAviso,
} from '../web/lib/tasks.js';
import { lerValor, formatarReal, resumoMes, nomeCartao } from '../web/lib/finance.js';

// ---------- datas ----------

test('diasEntre atravessa meses e anos', () => {
  assert.equal(diasEntre('2026-11-05', '2026-11-05'), 0);
  assert.equal(diasEntre('2026-11-05', '2026-12-05'), 30);
  assert.equal(diasEntre('2026-12-31', '2027-01-01'), 1);
  assert.equal(diasEntre('2026-11-05', '2026-11-01'), -4);
});

test('somarMeses usa o último dia quando o mês é mais curto', () => {
  assert.equal(somarMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(somarMeses('2028-01-31', 1), '2028-02-29');
  assert.equal(somarMeses('2026-12-15', 1), '2027-01-15');
  assert.equal(somarDias('2026-02-28', 1), '2026-03-01');
});

test('mudarMes, diasNoMes e nomeMes', () => {
  assert.equal(mudarMes('2026-01', -1), '2025-12');
  assert.equal(mudarMes('2026-12', 1), '2027-01');
  assert.equal(diasNoMes('2026-02'), 28);
  assert.equal(nomeMes('2026-03'), 'Março de 2026');
});

test('rotuloDia', () => {
  assert.equal(rotuloDia('2026-11-05', '2026-11-05'), 'Hoje');
  assert.equal(rotuloDia('2026-11-04', '2026-11-05'), 'Ontem');
  assert.equal(rotuloDia('2026-11-02', '2026-11-05'), 'Segunda, 02/11');
});

test('diaLocal respeita o fuso de São Paulo', () => {
  // 02:30 UTC do dia 06 ainda é dia 05 em São Paulo (UTC-3)
  assert.equal(diaLocal(new Date('2026-11-06T02:30:00Z'), 'America/Sao_Paulo'), '2026-11-05');
});

// ---------- tarefas ----------

const hoje = '2026-11-05';

test('classificar usa a janela de aviso da categoria', () => {
  assert.equal(classificar({ vencimento: '2026-11-08' }, 3, hoje), 'vencendo');
  assert.equal(classificar({ vencimento: '2026-11-09' }, 3, hoje), 'pendentes');
  assert.equal(classificar({ vencimento: '2026-11-20' }, 15, hoje), 'vencendo');
  assert.equal(classificar({ vencimento: '2026-11-01' }, 3, hoje), 'vencendo', 'atrasada fica em Vencendo');
  assert.equal(classificar({ vencimento: '2026-11-01', concluida_em: '2026-11-02T10:00:00Z' }, 3, hoje), 'concluidas');
});

test('separar ordena por vencimento e concluídas pela mais recente', () => {
  const tarefas = [
    { titulo: 'B', vencimento: '2026-11-07' },
    { titulo: 'A', vencimento: '2026-11-06' },
    { titulo: 'C', vencimento: '2026-12-30' },
    { titulo: 'D', vencimento: '2026-10-01', concluida_em: '2026-10-01T10:00:00Z' },
    { titulo: 'E', vencimento: '2026-10-02', concluida_em: '2026-10-03T10:00:00Z' },
  ];
  const abas = separar(tarefas, () => 3, hoje);
  assert.deepEqual(abas.vencendo.map((t) => t.titulo), ['A', 'B']);
  assert.deepEqual(abas.pendentes.map((t) => t.titulo), ['C']);
  assert.deepEqual(abas.concluidas.map((t) => t.titulo), ['E', 'D']);
});

test('rotuloPrazo', () => {
  assert.equal(rotuloPrazo('2026-11-02', hoje), 'Venceu há 3 dias');
  assert.equal(rotuloPrazo('2026-11-04', hoje), 'Venceu ontem');
  assert.equal(rotuloPrazo('2026-11-05', hoje), 'Vence hoje');
  assert.equal(rotuloPrazo('2026-11-06', hoje), 'Vence amanhã');
  assert.equal(rotuloPrazo('2026-11-15', hoje), 'Vence em 10 dias');
  assert.equal(rotuloPrazo('2027-01-20', hoje), 'Vence em 20/01');
});

test('adiar conta a partir de hoje quando a tarefa já venceu', () => {
  assert.equal(adiar('2026-11-10', '1d', hoje), '2026-11-11');
  assert.equal(adiar('2026-11-10', '1s', hoje), '2026-11-17');
  assert.equal(adiar('2026-11-01', '1d', hoje), '2026-11-06');
  assert.equal(adiar('2026-01-31', '1m', '2026-01-20'), '2026-02-28');
  assert.throws(() => adiar('2026-11-10', 'x', hoje));
});

test('etapaAviso: entrada em Vencendo, véspera, dia e dia seguinte, sem repetir', () => {
  const t = (vencimento, avisos_enviados = []) => ({ titulo: 'Luz', vencimento, avisos_enviados });
  assert.equal(etapaAviso(t('2026-11-08'), 3, hoje), 'entrou');
  assert.equal(etapaAviso(t('2026-11-09'), 3, hoje), null);
  assert.equal(etapaAviso(t('2026-11-06'), 3, hoje), 'vespera');
  assert.equal(etapaAviso(t('2026-11-05'), 3, hoje), 'hoje');
  assert.equal(etapaAviso(t('2026-11-04'), 3, hoje), 'atrasada');
  assert.equal(etapaAviso(t('2026-11-03'), 3, hoje), null);
  assert.equal(etapaAviso(t('2026-11-07', ['entrou']), 3, hoje), null);
  assert.equal(etapaAviso({ ...t('2026-11-05'), concluida_em: 'x' }, 3, hoje), null);
  assert.equal(textoAviso('hoje', t('2026-11-05')).titulo, 'Vence hoje');
});

// ---------- finanças ----------

test('lerValor entende os formatos do Atalho e do teclado', () => {
  assert.equal(lerValor('R$ 23,90'), 23.9);
  assert.equal(lerValor('R$ 1.234,56'), 1234.56);
  assert.equal(lerValor('1,234.56'), 1234.56);
  assert.equal(lerValor('23.9'), 23.9);
  assert.equal(lerValor('1.234'), 1234);
  assert.equal(lerValor('12,5'), 12.5);
  assert.equal(lerValor('BRL 7.00'), 7);
  assert.equal(lerValor('-R$ 5,00'), -5);
  assert.equal(lerValor('R$ -5,00'), -5);
  assert.equal(lerValor(19.999), 20);
  assert.ok(Number.isNaN(lerValor('abc')));
  assert.ok(Number.isNaN(lerValor(null)));
});

test('formatarReal', () => {
  assert.equal(formatarReal(1234.5), 'R$ 1.234,50');
});

test('resumoMes: renda, gasto, resta e limite por dia', () => {
  const gastos = [
    { valor: 100, cartao: 'Nubank', dia: '2026-11-01' },
    { valor: 50, cartao: 'Itaú', dia: '2026-11-03' },
    { valor: 30, cartao: 'Nubank', dia: '2026-11-05' }, // hoje
    { valor: 999, cartao: 'Nubank', dia: '2026-10-31' }, // outro mês
  ];
  const r = resumoMes({ renda: 3000, gastos, mes: '2026-11', hoje });
  assert.equal(r.gasto, 180);
  assert.equal(r.resta, 2820);
  assert.equal(r.gastoHoje, 30);
  assert.equal(r.diasRestantes, 26); // 05 a 30 de novembro
  // (3000 - 150 gastos até ontem) / 26 = 109,61 por dia; hoje já gastou 30
  assert.equal(r.porDia, 109.61);
  assert.equal(r.restaHoje, 79.61);
  assert.deepEqual(r.porCartao, [
    { cartao: 'Nubank', total: 130, quantidade: 2 },
    { cartao: 'Itaú', total: 50, quantidade: 1 },
  ]);
  assert.equal(r.gastos.length, 3);
});

test('resumoMes: mês passado não tem limite diário; mês futuro usa o mês inteiro', () => {
  const passado = resumoMes({ renda: 3000, gastos: [], mes: '2026-10', hoje });
  assert.equal(passado.diasRestantes, 0);
  assert.equal(passado.porDia, null);
  const futuro = resumoMes({ renda: 3000, gastos: [], mes: '2026-12', hoje });
  assert.equal(futuro.diasRestantes, 31);
  assert.equal(futuro.porDia, 96.77);
});

test('resumoMes: sem renda ou estourado', () => {
  const semRenda = resumoMes({ renda: 0, gastos: [{ valor: 10, dia: hoje }], mes: '2026-11', hoje });
  assert.equal(semRenda.porDia, null);
  assert.equal(semRenda.percentual, null);
  assert.equal(semRenda.porCartao[0].cartao, 'Sem cartão');
  const estourado = resumoMes({ renda: 100, gastos: [{ valor: 150, dia: '2026-11-01' }], mes: '2026-11', hoje });
  assert.equal(estourado.resta, -50);
  assert.equal(estourado.porDia, 0);
});

test('resumoMes soma centavos sem erro de arredondamento', () => {
  const gastos = Array.from({ length: 10 }, () => ({ valor: 0.1, dia: hoje }));
  assert.equal(resumoMes({ renda: 1, gastos, mes: '2026-11', hoje }).gasto, 1);
});

test('nomeCartao', () => {
  assert.equal(nomeCartao('  Nubank   Ultravioleta '), 'Nubank Ultravioleta');
  assert.equal(nomeCartao(''), null);
});

// ---------- cópias usadas no servidor ----------

test('as funções do servidor usam exatamente a mesma lógica do app', () => {
  for (const f of ['dates.js', 'tasks.js', 'finance.js', 'camarada.js']) {
    const app = readFileSync(new URL(`../web/lib/${f}`, import.meta.url), 'utf8');
    const servidor = readFileSync(new URL(`../supabase/functions/_shared/${f}`, import.meta.url), 'utf8');
    assert.equal(servidor, app, `${f} está diferente; rode: npm run sync`);
  }
});
