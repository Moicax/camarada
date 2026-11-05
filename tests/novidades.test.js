import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classificar, separar, rotuloPrazo, adiar, etapaAviso, textoAviso, horaCurta, normalizarHora,
  proximaData, proximaOcorrencia, etapaLembrete, textoLembrete, minutosAte,
} from '../web/lib/tasks.js';
import { resumoMes } from '../web/lib/finance.js';

const hoje = '2026-11-05';

test('horário: formato falado e normalização do banco', () => {
  assert.equal(horaCurta('18:00'), '18h');
  assert.equal(horaCurta('09:30:00'), '9h30');
  assert.equal(normalizarHora('07:05:00'), '07:05');
  assert.equal(normalizarHora('25:00'), null);
  assert.equal(normalizarHora(null), null);
});

test('tarefa sem data fica em Pendentes, no fim, sem avisos', () => {
  const sem = { titulo: 'Ler livro', vencimento: null };
  assert.equal(classificar(sem, 3, hoje), 'pendentes');
  assert.equal(rotuloPrazo(null, hoje), 'Sem data');
  assert.equal(etapaAviso(sem, 3, hoje), null);
  assert.equal(adiar(null, '1d', hoje), '2026-11-06');
  const abas = separar([sem, { titulo: 'Luz', vencimento: '2026-12-20' }], () => 3, hoje);
  assert.deepEqual(abas.pendentes.map((t) => t.titulo), ['Luz', 'Ler livro']);
});

test('no mesmo dia, horário mais cedo vem antes; sem horário no fim do dia', () => {
  const t = [
    { titulo: 'Sem hora', vencimento: '2026-11-06' },
    { titulo: 'Tarde', vencimento: '2026-11-06', hora: '15:00:00' },
    { titulo: 'Manhã', vencimento: '2026-11-06', hora: '08:30' },
  ];
  assert.deepEqual(separar(t, () => 3, hoje).vencendo.map((x) => x.titulo), ['Manhã', 'Tarde', 'Sem hora']);
});

test('prazo com horário', () => {
  assert.equal(rotuloPrazo('2026-11-05', hoje, '18:00'), 'Vence hoje às 18h');
  assert.equal(rotuloPrazo('2026-11-06', hoje, '09:30'), 'Vence amanhã às 9h30');
  assert.equal(rotuloPrazo('2026-11-09', hoje, '09:30'), 'Vence em 4 dias');
  assert.equal(textoAviso('hoje', { titulo: 'Dentista', vencimento: hoje, hora: '14:00' }).titulo, 'Vence hoje às 14h');
});

test('repetição: semanal, mensal com dia 31, anual', () => {
  assert.equal(proximaData('2026-11-05', 'semanal'), '2026-11-12');
  assert.equal(proximaData('2026-01-31', 'mensal', 31), '2026-02-28');
  assert.equal(proximaData('2026-02-28', 'mensal', 31), '2026-03-31', 'volta para o dia 31');
  assert.equal(proximaData('2028-02-29', 'anual', 29), '2029-02-28');
  assert.equal(proximaData('2026-11-05', null), null);
  assert.equal(proximaData(null, 'mensal'), null);
});

test('próxima ocorrência copia a tarefa e aponta para a original', () => {
  const t = { id: 'a1', titulo: 'Aluguel', vencimento: '2026-11-10', hora: '09:00:00', recorrencia: 'mensal', categoria_id: 'c1', notas: 'pix' };
  assert.deepEqual(proximaOcorrencia(t), {
    titulo: 'Aluguel', notas: 'pix', categoria_id: 'c1', hora: '09:00', recorrencia: 'mensal',
    dia_original: 10, vencimento: '2026-12-10', gerado_de: 'a1',
  });
  assert.equal(proximaOcorrencia({ ...t, recorrencia: null }), null);
});

test('lembretes 3h, 1h e 10 min antes, só uma vez cada, nada depois do horário', () => {
  const t = (hora, venc = hoje, avisos_enviados = []) => ({ titulo: 'Dentista', vencimento: venc, hora, avisos_enviados });
  const as = (h, m) => h * 60 + m; // agora
  assert.equal(etapaLembrete(t('18:00'), hoje, as(15, 0)), 'h3', 'exatamente 3h antes');
  assert.equal(etapaLembrete(t('18:00'), hoje, as(14, 59)), null, '3h01 antes ainda não');
  assert.equal(etapaLembrete(t('18:00', hoje, ['h3']), hoje, as(15, 30)), null, 'não repete');
  assert.equal(etapaLembrete(t('18:00', hoje, ['h3']), hoje, as(17, 0)), 'h1');
  assert.equal(etapaLembrete(t('18:00', hoje, ['h3', 'h1']), hoje, as(17, 50)), 'm10');
  assert.equal(etapaLembrete(t('18:00'), hoje, as(18, 1)), null, 'já passou');
  assert.equal(etapaLembrete(t('18:00'), hoje, as(13, 0)), null, 'mais de 3h antes');
  assert.equal(etapaLembrete(t('18:00'), hoje, as(17, 30)), 'h1', 'criada perto da hora: manda o da faixa atual');
  // virada do dia: tarefa à 0h30 de amanhã, agora 23h50
  assert.equal(minutosAte(t('00:30', '2026-11-06'), hoje, as(23, 50)), 40);
  assert.equal(etapaLembrete(t('00:30', '2026-11-06'), hoje, as(23, 50)), 'h1');
  assert.equal(etapaLembrete({ titulo: 'x', vencimento: hoje }, hoje, 0), null, 'sem horário');
  assert.equal(textoLembrete('m10', t('18:00')).titulo, 'Em 10 minutos: Dentista');
});

test('crédito × à vista', () => {
  const gastos = [
    { valor: 100, cartao: 'Nubank', dia: '2026-11-01' },                 // crédito (padrão)
    { valor: 40, cartao: 'Nubank', dia: '2026-11-02', forma: 'avista' }, // débito
    { valor: 60, cartao: 'Itaú', dia: '2026-11-03', forma: 'credito' },
    { valor: 25, cartao: null, dia: '2026-11-04', forma: 'avista' },      // Pix/dinheiro
  ];
  const r = resumoMes({ renda: 3000, gastos, mes: '2026-11', hoje });
  assert.equal(r.gasto, 225);
  assert.equal(r.credito, 160);
  assert.equal(r.avista, 65);
  assert.equal(r.saldo, 2935, 'no salário agora: renda menos o que foi à vista');
  assert.equal(r.resta, 2775, 'no orçamento do mês os dois contam');
  assert.deepEqual(r.faturas, [
    { cartao: 'Nubank', total: 100, quantidade: 1 },
    { cartao: 'Itaú', total: 60, quantidade: 1 },
  ]);
  assert.equal(r.gastos.find((g) => g.valor === 100).forma, 'credito');
});
