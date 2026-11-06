import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avisosDoDia, mensagensPush, rodarAvisos, instante, lembretesDaHora, mensagensLembrete, rodarLembretes } from '../servidor/avisos.js';
import { tratar } from '../servidor/rotas.js';
import { dadosIniciais } from '../servidor/nucleo.js';

const memoria = (inicial = {}) => {
  const m = structuredClone(inicial);
  return {
    ler: async (n, p) => (n in m ? structuredClone(m[n]) : p),
    gravar: async (n, v) => { m[n] = structuredClone(v); },
    listar: async prefixo => Object.keys(m).filter(k => k.startsWith(prefixo)).sort(),
    apagar: async n => { delete m[n]; },
    m
  };
};

function dadosCom(itens) {
  const d = dadosIniciais(new Date('2026-11-03T10:00:00Z'));
  const contas = d.categorias.find(c => c.nome === 'Contas').id;
  d.itens = itens.map(([id, data_limite, extra = {}]) => ({ id, titulo: 'Tarefa ' + id, categoria_id: contas, data_limite, concluido_em: null, apagado: false, criado_em: id, atualizado_em: 'x', ...extra }));
  return d;
}

test('momento de cada aviso e nada repetido', () => {
  const d = dadosCom([
    ['item-entra', '2026-11-07'], ['item-vesp', '2026-11-04'], ['item-hoje', '2026-11-03'],
    ['item-venc', '2026-11-01'], ['item-longe', '2026-12-30'], ['item-feito', '2026-11-04', { concluido_em: '2026-11-02' }]
  ]);
  const a = avisosDoDia(d, '2026-11-03');
  assert.deepEqual(a.map(x => [x.item.id, x.momento]), [['item-venc', 'venceu'], ['item-hoje', 'hoje'], ['item-vesp', 'vespera'], ['item-entra', 'entrou']]);
  const enviados = Object.fromEntries(a.map(x => [x.chave, '2026-11-03']));
  assert.equal(avisosDoDia(d, '2026-11-03', enviados).length, 0);
  // no dia seguinte, quem era véspera vira "hoje" e avisa de novo; o vencido não repete
  const amanha = avisosDoDia(d, '2026-11-04', enviados).map(x => [x.item.id, x.momento]);
  assert.deepEqual(amanha, [['item-hoje', 'venceu'], ['item-vesp', 'hoje']]);
});

test('muitos avisos viram uma notificação só', () => {
  const d = dadosCom([['a1-000000', '2026-11-04'], ['a2-000000', '2026-11-04'], ['a3-000000', '2026-11-04'], ['a4-000000', '2026-11-04']]);
  const m = mensagensPush(avisosDoDia(d, '2026-11-03'), 'https://x.app');
  assert.equal(m.length, 1);
  assert.equal(m[0].titulo, '4 tarefas pedem atenção');
  assert.equal(mensagensPush(avisosDoDia(d, '2026-11-03').slice(0, 2), 'https://x.app')[0].titulo, 'Vence amanhã');
});

test('tocar na notificação abre Tarefas › A expirar', () => {
  const d = dadosCom([['item-vesp', '2026-11-04']]);
  assert.equal(mensagensPush(avisosDoDia(d, '2026-11-03'), 'https://x.app')[0].url, 'https://x.app/#expirar');
});

test('rodada só no horário e uma vez por dia', async () => {
  const arm = memoria({ dados: dadosCom([['item-vesp', '2026-11-04']]) });
  const cedo = await rodarAvisos(arm, { agora: new Date('2026-11-03T08:00:00Z'), site: 'https://x.app' }); // 05h em SP
  assert.equal(cedo.feito, false);
  const r = await rodarAvisos(arm, { agora: new Date('2026-11-03T10:30:00Z'), site: 'https://x.app' }); // 07h30 em SP
  assert.equal(r.feito, true);
  assert.equal(r.avisos, 1);
  assert.equal(r.push, 'nenhum celular ativado');
  const deNovo = await rodarAvisos(arm, { agora: new Date('2026-11-03T11:30:00Z'), site: 'https://x.app' });
  assert.equal(deNovo.feito, false);
});

test('hora da tarefa é a de São Paulo', () => {
  assert.equal(new Date(instante('2026-11-04', '18:00')).toISOString(), '2026-11-04T21:00:00.000Z');
  assert.equal(new Date(instante('2026-11-04', '00:30')).toISOString(), '2026-11-04T03:30:00.000Z');
});

test('tarefa com hora avisa faltando 3 h, 1 h e 10 min, uma vez cada', () => {
  const d = dadosCom([['item-hora', '2026-11-04', { hora: '18:00' }], ['item-sem-hora', '2026-11-04'], ['item-feito', '2026-11-04', { hora: '18:00', concluido_em: '2026-11-04' }]]);
  const em = sp => Date.parse(`2026-11-04T${sp}:00-03:00`);
  const enviados = {};
  const marcos = [];
  // um minuto de cada vez, das 14h às 18h30
  for (let t = em('14:00'); t <= em('18:30'); t += 60e3) {
    for (const l of lembretesDaHora(d, t, enviados)) { enviados[l.chave] = 'x'; marcos.push([new Date(t - 3 * 3600e3).toISOString().slice(11, 16), l.marco]); }
  }
  assert.deepEqual(marcos, [['15:00', 180], ['17:00', 60], ['17:50', 10]]);
  const [m] = mensagensLembrete(lembretesDaHora(d, em('17:50')), 'https://x.app');
  assert.deepEqual(m, { titulo: 'Faltam 10 minutos', texto: 'Tarefa item-hora · às 18h', url: 'https://x.app/#expirar', tag: 'hora-item-hora' });
  // criada já em cima da hora: avisa uma vez, com o tempo que falta de verdade
  assert.equal(mensagensLembrete(lembretesDaHora(d, em('16:20')), 'https://x.app')[0].titulo, 'Falta 1 h 40 min');
  assert.equal(mensagensLembrete(lembretesDaHora(d, em('17:01')), 'https://x.app')[0].titulo, 'Falta 1 hora');
});

test('rodada dos lembretes não repete o mesmo aviso', async () => {
  const arm = memoria({ dados: dadosCom([['item-hora', '2026-11-04', { hora: '18:00' }]]) });
  const as = sp => new Date(`2026-11-04T${sp}:00-03:00`);
  assert.deepEqual(await rodarLembretes(arm, { agora: as('14:00'), site: 'https://x.app' }), { lembretes: 0 });
  assert.equal('lembretes' in arm.m, false); // nada na janela: nem abre as marcas
  const r = await rodarLembretes(arm, { agora: as('15:00'), site: 'https://x.app' });
  assert.deepEqual(r, { lembretes: 1, push: 'nenhum celular ativado' });
  assert.equal((await rodarLembretes(arm, { agora: as('15:01'), site: 'https://x.app' })).lembretes, 0);
  assert.equal((await rodarLembretes(arm, { agora: as('17:00'), site: 'https://x.app' })).lembretes, 1);
});

test('API: criar conta, sincronizar, chave de notificação e teste', async () => {
  const arm = memoria();
  const pedir = (rota, corpo, token) => tratar(new Request('http://local' + rota, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  }), arm, { site: 'https://x.app' });
  const { token } = await (await pedir('/api/criar-conta', { nome: 'Ana', senha: '123456' })).json();
  assert.ok(token);
  assert.equal((await pedir('/api/sincronizar', {})).status, 401);
  const dados = await (await pedir('/api/sincronizar', { preferencias: { horario: 8, atualizado_em: '9999' } }, token)).json();
  assert.equal(dados.preferencias.horario, 8);
  const { chave } = await (await pedir('/api/push-chave')).json();
  assert.match(chave, /^[\w-]{80,}$/);
  const teste = await (await pedir('/api/avisos-teste', {}, token)).json();
  assert.deepEqual(teste, { push: 'nenhum celular ativado' });
});
