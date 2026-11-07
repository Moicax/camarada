// Etapa 2: dinheiro sem salário (mesada por semana, renda que varia) e objetivos ("Juntar para…").
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  numeroDoDia, resumoSemana, resumoMes, situacaoDosObjetivos, compromissosDosObjetivos, rendaDoMes, periodoDe,
} from '../web/lib/finance.js';
import { segundasNoMes, inicioDaSemana } from '../web/lib/dates.js';
import { proximaConta } from '../web/lib/camarada.js';

const hoje = '2026-11-04'; // quarta-feira; semana de 02/11 (segunda) a 08/11 (domingo)

test('semanas e meses', () => {
  assert.equal(inicioDaSemana(hoje), '2026-11-02');
  assert.deepEqual(periodoDe(hoje, 'semana'), { inicio: '2026-11-02', fim: '2026-11-08' });
  assert.deepEqual(periodoDe(hoje, 'mes'), { inicio: '2026-11-01', fim: '2026-11-30' });
  assert.equal(segundasNoMes('2026-11'), 5); // 2, 9, 16, 23 e 30
  assert.equal(rendaDoMes({ tipoRenda: 'semanal', rendaSemanal: 70, mes: '2026-11' }), 350);
  assert.equal(rendaDoMes({ tipoRenda: 'variavel', renda: 3000, mes: '2026-11' }), 0);
  assert.equal(rendaDoMes({ tipoRenda: 'mensal', renda: 3000, mes: '2026-11' }), 3000);
});

test('mesada por semana: o limite do dia é o que resta na semana ÷ os dias que faltam dela', () => {
  const gastos = [
    { valor: 9, dia: '2026-11-01' }, // semana passada: não entra
    { valor: 10, dia: '2026-11-02' },
    { valor: 5, dia: '2026-11-03' },
    { valor: 3, dia: hoje },
  ];
  const r = resumoSemana({ rendaSemanal: 70, gastos, hoje });
  assert.equal(r.diasRestantes, 5); // quarta a domingo
  assert.equal(r.porDia, 11); // (70 − 15) ÷ 5
  assert.equal(r.restaHoje, 8); // 11 − 3 de hoje
  assert.equal(r.resta, 52);
  const d = numeroDoDia({ tipoRenda: 'semanal', rendaSemanal: 70, gastos, hoje });
  assert.equal(d.periodo, 'semana');
  assert.equal(d.restaHoje, 8);
});

test('mesada: conta que vence nesta semana já sai; a do mês que vem, não', () => {
  const tarefas = [
    { id: 'a', titulo: 'Recarga', vencimento: '2026-11-06', valor: 20 },
    { id: 'b', titulo: 'Curso', vencimento: '2026-11-20', valor: 100 },
  ];
  const d = numeroDoDia({ tipoRenda: 'semanal', rendaSemanal: 70, gastos: [], tarefas, hoje });
  assert.equal(d.comprometido, 20);
  assert.equal(d.porDia, 10); // (70 − 20) ÷ 5
});

test('renda que varia: o limite usa só o que já entrou', () => {
  const sem = numeroDoDia({ tipoRenda: 'variavel', renda: 5000, gastos: [], hoje });
  assert.equal(sem.restaHoje, null, 'sem nada entrar, não há limite (o salário do perfil não conta)');
  const com = numeroDoDia({ tipoRenda: 'variavel', gastos: [{ valor: -270, dia: '2026-11-03', forma: 'avista' }], hoje });
  assert.equal(com.porDia, 10); // 270 ÷ 27 dias (4 a 30)
});

const show = { id: 'o1', titulo: 'Show', valor_alvo: 600, data_alvo: '2027-01-20' };

test('objetivo: separa a cota do mês sozinho (o que falta ÷ meses até a data)', () => {
  const [s] = situacaoDosObjetivos({ objetivos: [show], hoje });
  assert.equal(s.cota, 200); // novembro, dezembro e janeiro
  assert.equal(s.reservado, 200);
  const d = numeroDoDia({ renda: 3000, gastos: [], objetivos: [show], hoje });
  const sem = numeroDoDia({ renda: 3000, gastos: [], hoje });
  assert.equal(sem.resta - d.resta, 200);
});

test('objetivo: "Guardei" abate a reserva e não conta duas vezes (nem come o limite de hoje)', () => {
  const antes = numeroDoDia({ renda: 3000, gastos: [], objetivos: [show], hoje });
  const guardei = { valor: 200, dia: hoje, investimento: true, objetivo_id: 'o1', forma: 'avista' };
  const depois = numeroDoDia({ renda: 3000, gastos: [guardei], objetivos: [show], movimentos: [guardei], hoje });
  assert.equal(depois.resta, antes.resta);
  assert.equal(depois.restaHoje, antes.restaHoje);
  assert.equal(depois.porDia, antes.porDia);
  assert.equal(depois.comprometido, 0);
  const parcial = { ...guardei, valor: 50 };
  const [s] = situacaoDosObjetivos({ objetivos: [show], movimentos: [parcial], hoje });
  assert.equal(s.reservado, 150);
  assert.equal(s.guardado, 50);
});

test('objetivo: no mês seguinte a cota se ajusta ao que já foi guardado', () => {
  const guardado = { valor: 300, dia: '2026-11-10', investimento: true, objetivo_id: 'o1' };
  const [dez] = situacaoDosObjetivos({ objetivos: [show], movimentos: [guardado], hoje: '2026-12-02' });
  assert.equal(dez.cota, 150); // (600 − 300) ÷ 2 (dezembro e janeiro)
});

test('objetivo: atingido, vencido ou concluído não separa nada', () => {
  const cheio = { valor: 600, dia: '2026-11-03', investimento: true, objetivo_id: 'o1' };
  const [a] = situacaoDosObjetivos({ objetivos: [show], movimentos: [cheio], hoje });
  assert.equal(a.atingido, true);
  assert.equal(a.reservado, 0);
  const [v] = situacaoDosObjetivos({ objetivos: [{ ...show, data_alvo: '2026-11-01' }], hoje });
  assert.equal(v.prazoPassou, true);
  assert.equal(v.reservado, 0);
  assert.equal(situacaoDosObjetivos({ objetivos: [{ ...show, concluido_em: '2026-11-03T10:00:00Z' }], hoje }).length, 0);
});

test('objetivo por semana (mesada): cota da semana', () => {
  const tenis = { id: 'o2', titulo: 'Tênis', valor_alvo: 200, data_alvo: '2026-11-29' }; // 4 semanas (02, 09, 16 e 23/11)
  const [s] = situacaoDosObjetivos({ objetivos: [tenis], hoje, periodo: 'semana' });
  assert.equal(s.cota, 50);
  const c = compromissosDosObjetivos({ objetivos: [tenis], hoje, periodo: 'semana' });
  assert.equal(c[0].vencimento, '2026-11-08');
  assert.equal(proximaConta(c, '2026-11-08'), null, 'a reserva do objetivo não vira aviso de conta');
});

test('usar o dinheiro do objetivo: tira do objetivo e lança o gasto sem mexer no limite de hoje', () => {
  const guardado = { valor: 600, dia: '2026-11-03', investimento: true, objetivo_id: 'o1', forma: 'avista' };
  const antes = numeroDoDia({ renda: 3000, gastos: [guardado], objetivos: [show], movimentos: [guardado], hoje });
  const tirou = { valor: -600, dia: hoje, investimento: true, objetivo_id: 'o1', forma: 'avista' };
  const comprou = { valor: 600, dia: hoje, objetivo_id: 'o1', forma: 'avista' };
  const concluido = { ...show, concluido_em: `${hoje}T15:00:00Z` };
  const depois = numeroDoDia({ renda: 3000, gastos: [guardado, tirou, comprou], objetivos: [concluido], movimentos: [guardado, tirou], hoje });
  assert.equal(depois.resta, antes.resta);
  assert.equal(depois.restaHoje, antes.restaHoje);
  assert.equal(depois.gasto - antes.gasto, 600, 'a compra conta como gasto (e na meta de gastos)');
});

test('meta de investimento não conta o guardado para objetivos', () => {
  const g = [{ valor: 100, dia: '2026-11-03', investimento: true }, { valor: 200, dia: '2026-11-03', investimento: true, objetivo_id: 'o1' }];
  const r = resumoMes({ renda: 3000, gastos: g, mes: '2026-11', hoje, metaInvestimento: 500 });
  assert.equal(r.investido, 100);
  assert.equal(r.guardadoObjetivos, 200);
  assert.equal(r.metaInvestimento.investido, 100);
  assert.equal(r.resta, 2700, 'os dois saem do que dá para gastar');
});
