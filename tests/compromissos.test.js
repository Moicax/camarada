// "Dinheiro com dono": contas a pagar (tarefas com valor) saem do que dá para gastar antes de vencer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compromissosDoMes, resumoMes } from '../web/lib/finance.js';
import { proximaOcorrencia } from '../web/lib/tasks.js';

const hoje = '2026-11-05'; // 26 dias até o fim do mês, contando hoje
const mes = '2026-11';
const conta = (id, vencimento, valor, extra = {}) => ({ id, titulo: id, vencimento, valor, concluida_em: null, ...extra });

test('contas do mês: abertas, com valor, até o fim do mês (atrasadas entram)', () => {
  const tarefas = [
    conta('luz', '2026-11-10', 180),
    conta('atrasada', '2026-11-02', 50),
    conta('dezembro', '2026-12-03', 900),
    conta('paga', '2026-11-15', 70, { concluida_em: '2026-11-04T12:00:00Z' }),
    conta('sem-data', null, 30),
    conta('sem-valor', '2026-11-20', null),
    conta('de-outubro', '2026-10-28', 40), // atrasada desde o mês passado: ainda vai sair do bolso
  ];
  assert.deepEqual(compromissosDoMes(tarefas, mes, hoje).map((c) => c.id), ['de-outubro', 'atrasada', 'luz']);
  assert.deepEqual(compromissosDoMes(tarefas, '2026-12', hoje).map((c) => c.id), ['dezembro'], 'mês futuro: só as dele');
  assert.deepEqual(compromissosDoMes(tarefas, '2026-10', hoje), [], 'mês que passou: nenhuma');
  assert.equal(compromissosDoMes(tarefas, mes, hoje)[2].valor, 180);
});

test('uma conta de R$ 180 tira exatamente R$ 180 do mês e o limite do dia na medida certa', () => {
  const gastos = [{ valor: 100, dia: '2026-11-02', forma: 'avista' }];
  const sem = resumoMes({ renda: 3000, gastos, mes, hoje });
  const com = resumoMes({ renda: 3000, gastos, mes, hoje, compromissos: [{ valor: 180 }] });
  assert.equal(sem.resta - com.resta, 180);
  assert.equal(com.comprometido, 180);
  // (3000 − 100 − 180) ÷ 26 dias = 104,61 (sem a conta: 2900 ÷ 26 = 111,53)
  assert.equal(sem.porDia, 111.53);
  assert.equal(com.porDia, 104.61);
  assert.equal(com.gasto, sem.gasto, 'a conta ainda não é gasto');
  assert.equal(com.saldo, sem.saldo, 'o dinheiro ainda está no salário até pagar');
});

test('pagar a conta não conta duas vezes: o que resta fica igual, ao centavo', () => {
  const luz = conta('luz', '2026-11-10', 180.37);
  const gastos = [{ valor: 45.9, dia: '2026-11-03', forma: 'credito' }];
  const antes = resumoMes({ renda: 2500, gastos, mes, hoje, compromissos: compromissosDoMes([luz], mes, hoje) });
  // "Paguei": a tarefa é concluída e vira um gasto à vista com o mesmo valor, hoje.
  const paga = { ...luz, concluida_em: '2026-11-05T15:00:00Z' };
  const depois = resumoMes({
    renda: 2500, gastos: [...gastos, { valor: 180.37, dia: hoje, forma: 'avista', tarefa_id: 'luz' }], mes, hoje,
    compromissos: compromissosDoMes([paga], mes, hoje),
  });
  assert.equal(depois.resta, antes.resta);
  // O dinheiro já estava separado: pagar a conta hoje não come o limite de hoje.
  assert.equal(depois.restaHoje, antes.restaHoje);
  assert.equal(depois.porDia, antes.porDia);
  assert.equal(depois.gastoHoje, antes.gastoHoje);
  assert.equal(depois.comprometido, 0);
  assert.equal(depois.gasto - antes.gasto, 180.37);
});

test('contas levando tudo: o limite do dia vira zero (não some)', () => {
  const r = resumoMes({ renda: 1000, gastos: [], mes, hoje, compromissos: [{ valor: 1200 }] });
  assert.equal(r.porDia, 0);
  assert.equal(r.restaHoje, 0);
  assert.equal(r.resta, -200);
  const semRenda = resumoMes({ renda: 0, gastos: [], mes, hoje, compromissos: [{ valor: 50 }] });
  assert.equal(semRenda.porDia, null, 'sem renda continua sem limite do dia');
});

test('mês que passou não desconta conta nenhuma', () => {
  const r = resumoMes({ renda: 3000, gastos: [], mes: '2026-10', hoje, compromissos: [{ valor: 500 }] });
  assert.equal(r.comprometido, 0);
  assert.equal(r.resta, 3000);
});

test('conta que repete: a do mês seguinte já nasce com o valor', () => {
  const t = { id: 'a1', titulo: 'Internet', vencimento: '2026-11-15', recorrencia: 'mensal', valor: '99.90' };
  assert.equal(proximaOcorrencia(t).valor, 99.9);
  assert.equal(proximaOcorrencia({ ...t, valor: null }).valor, null);
});

test('o Camarada avisa da conta que vence hoje ou amanhã, com o valor já separado', async () => {
  const { proximaConta, conselho } = await import('../web/lib/camarada.js');
  const lista = compromissosDoMes([conta('Conta de luz', '2026-11-06', 180), conta('Aluguel', '2026-11-20', 1500)], mes, hoje);
  const c = proximaConta(lista, hoje);
  assert.deepEqual(c, { titulo: 'Conta de luz', valor: 180, quando: 'amanhã' });
  assert.equal(proximaConta(lista, '2026-11-10'), null, 'nada vencendo hoje ou amanhã');
  assert.match(conselho({ conta: c }), /^Conta de luz vence amanhã: R\$\s180,00 já estão separados\.$/);
  assert.match(conselho({ atrasadas: 1, conta: c }), /atrasada/, 'atrasada vem antes');
});
