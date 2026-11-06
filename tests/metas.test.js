import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumoMes, nivelMeta, tipoDe } from '../web/lib/finance.js';

const hoje = '2026-11-15';
const mes = '2026-11';
const resumo = (gastos, extra = {}) => resumoMes({ renda: 3000, gastos, mes, hoje, ...extra });

test('investir R$ 200 tira R$ 200 do que dá para gastar, sem virar gasto', () => {
  const base = [{ valor: 100, dia: '2026-11-03' }];
  const a = resumo(base);
  const b = resumo([...base, { valor: 200, investimento: true, forma: 'avista', dia: '2026-11-10' }]);
  assert.equal(b.investido, 200);
  assert.equal(b.gasto, a.gasto, 'investimento não conta como gasto');
  assert.equal(b.disponivel, a.disponivel - 200);
  assert.equal(b.resta, a.resta - 200);
  assert.ok(b.porDia < a.porDia, 'o limite por dia cai');
  assert.equal(b.saldo, a.saldo - 200, 'saiu do salário');
  assert.equal(tipoDe({ valor: 200, investimento: true }), 'investimento');
});

test('apagar o investimento devolve exatamente; resgate devolve ao disponível', () => {
  const base = [{ valor: 100, dia: '2026-11-03' }];
  const inv = { valor: 200, investimento: true, forma: 'avista', dia: '2026-11-10' };
  assert.deepEqual(resumo(base).resta, resumo([...base, inv, { ...inv, valor: -200 }]).resta);
  assert.equal(tipoDe({ valor: -50, investimento: true }), 'resgate');
});

test('meta de investimento: progresso e quanto falta', () => {
  const r = resumo([{ valor: 200, investimento: true, dia: '2026-11-10' }], { metaInvestimento: 500 });
  assert.deepEqual(r.metaInvestimento, { meta: 500, investido: 200, falta: 300, pct: 0.4, atingida: false });
  const r2 = resumo([{ valor: 600, investimento: true, dia: '2026-11-10' }], { metaInvestimento: 500 });
  assert.equal(r2.metaInvestimento.atingida, true);
  assert.equal(r2.metaInvestimento.falta, 0);
  assert.equal(resumo([]).metaInvestimento, null, 'sem meta');
});

test('meta de gastos: alerta aos 80% e aos 100%', () => {
  const com = (v) => resumo([{ valor: v, dia: '2026-11-10' }], { metaGasto: 1000 }).metaGasto;
  assert.equal(com(799.99).nivel, null);
  assert.equal(com(800).nivel, 80);
  assert.equal(com(999.99).nivel, 80);
  assert.equal(com(1000).nivel, 100);
  assert.equal(com(1500).nivel, 100);
  assert.equal(com(1500).falta, -500);
  assert.equal(com(250).pct, 0.25);
  assert.equal(resumo([]).metaGasto, null, 'sem meta');
});

test('meta de gastos considera só gastos: entradas e investimentos não contam', () => {
  const r = resumo([
    { valor: 700, dia: '2026-11-02' },
    { valor: 500, investimento: true, dia: '2026-11-03' },
    { valor: -300, forma: 'avista', dia: '2026-11-04' },
  ], { metaGasto: 1000 });
  assert.equal(r.metaGasto.usado, 700);
  assert.equal(r.metaGasto.nivel, null);
});

test('nivelMeta', () => {
  assert.equal(nivelMeta(null), null);
  assert.equal(nivelMeta(0.79), null);
  assert.equal(nivelMeta(0.8), 80);
  assert.equal(nivelMeta(1), 100);
});
