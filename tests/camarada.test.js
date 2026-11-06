import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inicioDaSemana, eventos, sequencia, resumoCamarada, conselho, cumprimento, contarHoje, PONTOS,
} from '../web/lib/camarada.js';

const hoje = '2026-11-06'; // sexta
const fuso = 'America/Sao_Paulo';
const concluida = (dia, hora = '15:00') => new Date(`${dia}T${hora}:00-03:00`).toISOString();

test('semana começa na segunda', () => {
  assert.equal(inicioDaSemana('2026-11-06'), '2026-11-02');
  assert.equal(inicioDaSemana('2026-11-02'), '2026-11-02');
  assert.equal(inicioDaSemana('2026-11-08'), '2026-11-02', 'domingo é o fim da semana');
});

test('tarefa no prazo vale 10, atrasada vale 5, sem data vale 10', () => {
  const tarefas = [
    { titulo: 'Luz', vencimento: '2026-11-05', concluida_em: concluida('2026-11-04') },
    { titulo: 'Água', vencimento: '2026-11-03', concluida_em: concluida('2026-11-05') },
    { titulo: 'Ler', vencimento: null, concluida_em: concluida('2026-11-06') },
    { titulo: 'Aberta', vencimento: '2026-11-06' },
    { titulo: 'Semana passada', vencimento: '2026-11-01', concluida_em: concluida('2026-11-01') },
  ];
  const e = eventos({ tarefas, de: '2026-11-02', ate: '2026-11-08', hoje, timeZone: fuso });
  assert.deepEqual(e.map((x) => [x.texto, x.pontos]), [['Ler', 10], ['Água', 5], ['Luz', 10]]);
});

test('reabrir a tarefa tira os pontos (calculado do que existe)', () => {
  const t = { titulo: 'Luz', vencimento: '2026-11-05', concluida_em: concluida('2026-11-04') };
  const com = resumoCamarada({ tarefas: [t], gastos: [], hoje, timeZone: fuso });
  const sem = resumoCamarada({ tarefas: [{ ...t, concluida_em: null }], gastos: [], hoje, timeZone: fuso });
  assert.equal(com.pontos - sem.pontos, PONTOS.tarefaNoPrazo);
});

test('dia dentro do limite: só dias que já acabaram, e só com renda', () => {
  const rendaDe = () => 3000; // novembro: 30 dias → R$ 100 por dia no começo
  const gastos = [
    { valor: 50, dia: '2026-11-02' },   // segunda: dentro
    { valor: 400, dia: '2026-11-03' },  // terça: estourou
    { valor: 10, dia: '2026-11-06' },   // hoje: ainda não conta
  ];
  const e = eventos({ gastos, rendaDe, de: '2026-11-02', ate: '2026-11-08', hoje, timeZone: fuso });
  const dias = e.filter((x) => x.tipo === 'limite').map((x) => x.dia).sort();
  assert.deepEqual(dias, ['2026-11-02', '2026-11-04', '2026-11-05'], 'quarta e quinta sem gasto também contam');
  const semRenda = eventos({ gastos, rendaDe: () => 0, de: '2026-11-02', ate: '2026-11-08', hoje, timeZone: fuso });
  assert.equal(semRenda.filter((x) => x.tipo === 'limite').length, 0);
});

test('o limite de um dia passado não é afetado por gastos de depois', () => {
  const rendaDe = () => 3000;
  const antes = eventos({ gastos: [{ valor: 90, dia: '2026-11-02' }], rendaDe, de: '2026-11-02', ate: '2026-11-02', hoje, timeZone: fuso });
  const depois = eventos({ gastos: [{ valor: 90, dia: '2026-11-02' }, { valor: 2500, dia: '2026-11-05' }], rendaDe, de: '2026-11-02', ate: '2026-11-02', hoje, timeZone: fuso });
  assert.deepEqual(antes, depois);
});

test('investimento: +15 por dia com investimento (vários no mesmo dia contam uma vez)', () => {
  const gastos = [
    { valor: 100, investimento: true, dia: '2026-11-04' },
    { valor: 50, investimento: true, dia: '2026-11-04' },
    { valor: -30, investimento: true, dia: '2026-11-05' }, // resgate não conta
  ];
  const e = eventos({ gastos, de: '2026-11-02', ate: '2026-11-08', hoje, timeZone: fuso });
  assert.deepEqual(e.map((x) => [x.dia, x.pontos]), [['2026-11-04', 15]]);
});

test('sequência de dias seguidos', () => {
  const ev = (...dias) => dias.map((dia) => ({ dia, pontos: 5 }));
  assert.equal(sequencia({ eventos: ev('2026-11-05', '2026-11-04', '2026-11-03', '2026-11-01'), hoje }), 3, 'até ontem');
  assert.equal(sequencia({ eventos: ev('2026-11-06', '2026-11-05'), hoje }), 2, 'hoje conta se já teve algo');
  assert.equal(sequencia({ eventos: ev('2026-11-04'), hoje }), 0, 'ontem sem nada quebra');
});

test('recompensa da semana', () => {
  const tarefas = Array.from({ length: 10 }, (_, i) => ({ titulo: `T${i}`, vencimento: null, concluida_em: concluida('2026-11-03') }));
  const r = resumoCamarada({ tarefas, gastos: [], hoje, timeZone: fuso, metaPontos: 100, recompensa: '  Pizza  ' });
  assert.equal(r.pontos, 100);
  assert.equal(r.liberada, true);
  assert.equal(r.falta, 0);
  assert.equal(r.recompensa, 'Pizza');
  const r2 = resumoCamarada({ tarefas: tarefas.slice(0, 3), gastos: [], hoje, timeZone: fuso, metaPontos: 0 });
  assert.equal(r2.meta, 100, 'meta padrão');
  assert.equal(r2.falta, 70);
  assert.equal(r2.pct, 0.3);
});

test('conselho do dia, por prioridade', () => {
  assert.match(conselho({ camarada: { liberada: true, recompensa: 'Pizza' } }), /Aproveite: Pizza/);
  assert.match(conselho({ atrasadas: 2 }), /2 tarefas estão atrasadas/);
  assert.match(conselho({ atrasadas: 1 }), /1 tarefa está atrasada/);
  assert.match(conselho({ nivelMeta: 100 }), /passou da meta/);
  assert.match(conselho({ restaHoje: -5 }), /passou do limite/);
  assert.match(conselho({ nivelMeta: 80 }), /80%/);
  assert.match(conselho({ vencemHoje: 1 }), /1 tarefa vence hoje/);
  assert.match(conselho({ camarada: { falta: 15, sequencia: 0 } }), /Faltam só 15 pontos/);
  assert.match(conselho({ camarada: { falta: 50, sequencia: 4 } }), /4 dias seguidos/);
  assert.equal(conselho({}), 'Tudo em dia. Bom trabalho!');
});

test('cumprimento e contagem de hoje', () => {
  assert.equal(cumprimento(7), 'Bom dia');
  assert.equal(cumprimento(13), 'Boa tarde');
  assert.equal(cumprimento(20), 'Boa noite');
  assert.equal(cumprimento(2), 'Boa noite');
  assert.deepEqual(contarHoje([
    { vencimento: '2026-11-05' }, { vencimento: '2026-11-06' }, { vencimento: '2026-11-06', concluida_em: 'x' }, { vencimento: null },
  ], hoje), { atrasadas: 1, vencemHoje: 1 });
});
