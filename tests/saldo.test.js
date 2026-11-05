// O saldo tem que ser "sincero": lançar e apagar volta ao valor exato, editar muda só a diferença,
// e nenhuma combinação de lançamentos deixa sobra de centavos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumoMes, lerValor } from '../web/lib/finance.js';

const hoje = '2026-11-15';
const mes = '2026-11';

// Sorteio reproduzível (mesma semente, mesmos números).
function sorteador(semente) {
  let x = semente;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

function lancamentoAleatorio(r, i) {
  const centavos = 1 + Math.floor(r() * 50000); // R$ 0,01 a R$ 500,00
  const tipo = r();
  const dia = `2026-11-${String(1 + Math.floor(r() * 30)).padStart(2, '0')}`;
  const forma = r() < 0.4 ? 'avista' : 'credito';
  const valor = (tipo < 0.85 ? 1 : -1) * centavos / 100; // ~15% entradas/estornos
  return { id: `g${i}`, valor, forma, cartao: forma === 'credito' ? (r() < 0.5 ? 'Nubank' : 'Itaú') : null, dia };
}

const chaves = ['entradas', 'disponivel', 'gasto', 'resta', 'gastoHoje', 'credito', 'avista', 'saldo', 'porDia', 'restaHoje'];
const totais = (r) => Object.fromEntries(chaves.map((k) => [k, r[k]]));
const resumo = (gastos, renda = 3000) => resumoMes({ renda, gastos, mes, hoje });
const centavos = (n) => Math.round(n * 100);

test('lançar e apagar volta exatamente ao mesmo saldo (500 sorteios)', () => {
  const r = sorteador(42);
  for (let rodada = 0; rodada < 500; rodada++) {
    const lista = Array.from({ length: Math.floor(r() * 40) }, (_, i) => lancamentoAleatorio(r, i));
    const antes = resumo(lista);
    const novo = lancamentoAleatorio(r, 'novo');
    const com = resumo([...lista, novo]);
    const depois = resumo(lista); // apagou o que tinha lançado
    assert.deepEqual(totais(depois), totais(antes));
    // O efeito no "resta" é exatamente o valor lançado (gasto tira, entrada soma).
    assert.equal(centavos(antes.resta) - centavos(com.resta), centavos(novo.valor), `rodada ${rodada}`);
  }
});

test('editar o valor muda o saldo só pela diferença', () => {
  const r = sorteador(7);
  for (let rodada = 0; rodada < 300; rodada++) {
    const lista = Array.from({ length: 1 + Math.floor(r() * 30) }, (_, i) => lancamentoAleatorio(r, i));
    const alvo = Math.floor(r() * lista.length);
    const original = lista[alvo];
    const novoValor = Math.round((r() * 600 - 50) * 100) / 100 || 1;
    const editada = lista.map((g, i) => (i === alvo ? { ...g, valor: novoValor } : g));
    const dif = centavos(resumo(lista).resta) - centavos(resumo(editada).resta);
    assert.equal(dif, centavos(novoValor) - centavos(original.valor), `rodada ${rodada}`);
  }
});

test('nenhuma combinação deixa sobra de centavos: resta = renda + entradas − gasto', () => {
  const r = sorteador(2026);
  for (let rodada = 0; rodada < 500; rodada++) {
    const lista = Array.from({ length: Math.floor(r() * 60) }, (_, i) => lancamentoAleatorio(r, i));
    const renda = Math.round(r() * 1000000) / 100;
    const s = resumo(lista, renda);
    const soma = lista.reduce((t, g) => t + centavos(g.valor), 0);
    assert.equal(centavos(s.resta), centavos(renda) - soma);
    assert.equal(centavos(s.resta), centavos(s.renda) + centavos(s.entradas) - centavos(s.gasto));
    assert.equal(centavos(s.gasto), centavos(s.credito) + centavos(s.avista), 'gasto = crédito + à vista');
    assert.equal(centavos(s.saldo), centavos(s.disponivel) - centavos(s.avista));
    const somaFaturas = s.faturas.reduce((t, f) => t + centavos(f.total), 0);
    assert.equal(somaFaturas, centavos(s.credito), 'faturas somam o crédito');
  }
});

test('trocar crédito ↔ à vista não muda o saldo do mês, só onde ele aparece', () => {
  const lista = [{ valor: 100, forma: 'credito', cartao: 'Nubank', dia: '2026-11-10' }];
  const a = resumo(lista);
  const b = resumo([{ ...lista[0], forma: 'avista' }]);
  assert.equal(a.resta, b.resta);
  assert.deepEqual([a.credito, a.avista, b.credito, b.avista], [100, 0, 0, 100]);
  assert.equal(b.saldo, a.saldo - 100, 'à vista sai do salário na hora');
});

test('mudar o gasto de mês tira de um mês e põe no outro', () => {
  const g = { valor: 80, dia: '2026-11-10' };
  const nov = (lista) => resumoMes({ renda: 3000, gastos: lista, mes: '2026-11', hoje });
  const out = (lista) => resumoMes({ renda: 3000, gastos: lista, mes: '2026-10', hoje });
  const movido = { ...g, dia: '2026-10-28' };
  assert.equal(nov([movido]).resta - nov([g]).resta, 80);
  assert.equal(out([g]).resta - out([movido]).resta, 80);
});

test('entrada soma no saldo, não conta como gasto, e se espalha pelos dias que faltam', () => {
  const base = [{ valor: 300, dia: '2026-11-02' }];
  const comEntrada = [...base, { valor: -160, forma: 'avista', estabelecimento: 'Freela', dia: hoje }];
  const a = resumo(base);
  const b = resumo(comEntrada);
  assert.equal(b.entradas, 160);
  assert.equal(b.gasto, a.gasto, 'entrada não diminui o gasto');
  assert.equal(b.resta, a.resta + 160);
  assert.equal(b.restaHoje - a.restaHoje, Math.floor(16000 / a.diasRestantes) / 100, 'hoje ganha só a parte do dia');
});

test('estorno no cartão diminui o gasto e a fatura', () => {
  const s = resumo([
    { valor: 200, forma: 'credito', cartao: 'Nubank', dia: '2026-11-03' },
    { valor: -50, forma: 'credito', cartao: 'Nubank', dia: '2026-11-04' },
  ]);
  assert.equal(s.gasto, 150);
  assert.equal(s.entradas, 0);
  assert.deepEqual(s.faturas, [{ cartao: 'Nubank', total: 150, quantidade: 2 }]);
});

test('apagar um gasto de dias atrás aumenta o limite por dia na medida certa', () => {
  const lista = [{ valor: 260, dia: '2026-11-03' }, { valor: 40, dia: hoje }];
  const a = resumo(lista);
  const b = resumo([lista[1]]);
  assert.equal(b.porDia - a.porDia, Math.round((Math.floor((300000 - 4000) / 16) - Math.floor((300000 - 26000 - 4000) / 16))) / 100);
  assert.equal(b.gastoHoje, a.gastoHoje, 'o gasto de hoje continua igual');
});

test('valores digitados viram centavos exatos', () => {
  for (const [texto, esperado] of [['0,10', 0.1], ['0,20', 0.2], ['1.000,01', 1000.01], ['19,99', 19.99], ['0,01', 0.01]]) {
    assert.equal(lerValor(texto), esperado);
  }
  const lista = Array.from({ length: 3 }, () => ({ valor: lerValor('0,10'), dia: hoje }));
  assert.equal(resumo(lista).gasto, 0.3, '0,10 + 0,10 + 0,10 = 0,30, sem 0,30000000000000004');
});
