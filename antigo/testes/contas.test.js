import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tratar } from '../servidor/rotas.js';
import { dadosIniciais, hashSenha, hashToken } from '../servidor/nucleo.js';
import { armazemDe, nomeDeEntrada, chaveAtalho } from '../servidor/contas.js';
import { rodadaDeTodos } from '../servidor/avisos.js';

function memoria(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return {
    ler: async (n, p) => (m.has(n) ? structuredClone(m.get(n)) : p),
    gravar: async (n, v) => { m.set(n, structuredClone(v)); },
    listar: async prefixo => [...m.keys()].filter(k => k.startsWith(prefixo)).sort(),
    apagar: async n => { m.delete(n); },
    m
  };
}
const pedir = async (armazem, caminho, corpo, token) => {
  const r = await tratar(new Request('https://camarada.test' + caminho, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  }), armazem, { site: 'https://camarada.test' });
  return { status: r.status, ...(await r.json()) };
};
const item = (id, titulo) => ({ id, titulo, data_limite: null, atualizado_em: '2026-11-04T10:00:00.000Z' });
const codigoDo = url => url.split('#convite=')[1];

test('o nome de entrada não liga para acento, maiúscula e espaço', () => {
  assert.equal(nomeDeEntrada('Moisés'), 'moises');
  assert.equal(nomeDeEntrada('  MOISÉS '), 'moises');
  assert.equal(nomeDeEntrada('João  da Silva'), 'joao-da-silva');
  assert.equal(nomeDeEntrada('../conta'), 'conta');
  assert.equal(nomeDeEntrada(''), '');
});

test('primeira conta cuida do app; as outras só pelo convite', async () => {
  const arm = memoria();
  assert.equal((await pedir(arm, '/api/estado')).primeira, true);
  const ana = await pedir(arm, '/api/criar-conta', { nome: 'Ana', senha: 'senha-ana' });
  assert.equal(ana.status, 200);
  assert.equal((await pedir(arm, '/api/estado')).primeira, false);

  // sem convite, ninguém mais cria conta
  assert.equal((await pedir(arm, '/api/criar-conta', { nome: 'Beto', senha: 'senha-beto' })).status, 403);

  const { convite, pessoas } = await pedir(arm, '/api/pessoas', {}, ana.token);
  assert.match(convite, /^https:\/\/camarada\.test\/#convite=[\w-]{16}$/);
  assert.deepEqual(pessoas.map(p => [p.nome, p.dono, p.voce]), [['ana', true, true]]);

  const beto = await pedir(arm, '/api/criar-conta', { nome: 'Beto', senha: 'senha-beto', convite: codigoDo(convite) });
  assert.equal(beto.status, 200);
  // nome repetido, mesmo com acento ou maiúscula diferente
  assert.equal((await pedir(arm, '/api/criar-conta', { nome: 'BETO', senha: 'outra-senha', convite: codigoDo(convite) })).status, 409);

  // quem não é dono não vê as pessoas
  assert.equal((await pedir(arm, '/api/pessoas', {}, beto.token)).status, 403);
  // a conta nova já vem chamando a pessoa pelo nome
  assert.equal((await pedir(arm, '/api/sincronizar', {}, beto.token)).preferencias.apelido, 'Beto');

  // trocar o link desliga o antigo
  const { convite: novo } = await pedir(arm, '/api/pessoas', { novo_convite: true }, ana.token);
  assert.notEqual(novo, convite);
  assert.equal((await pedir(arm, '/api/criar-conta', { nome: 'Caio', senha: 'senha-caio', convite: codigoDo(convite) })).status, 403);
  assert.equal((await pedir(arm, '/api/criar-conta', { nome: 'Caio', senha: 'senha-caio', convite: codigoDo(novo) })).status, 200);
});

test('cada conta só vê os próprios dados', async () => {
  const arm = memoria();
  const ana = await pedir(arm, '/api/criar-conta', { nome: 'Ana', senha: 'senha-ana' });
  const { convite } = await pedir(arm, '/api/pessoas', {}, ana.token);
  const beto = await pedir(arm, '/api/criar-conta', { nome: 'Beto', senha: 'senha-beto', convite: codigoDo(convite) });

  await pedir(arm, '/api/sincronizar', { itens: [item('item-da-ana', 'Pagar luz')], gastos: [{ id: 'gasto-da-ana', valor: 5000, atualizado_em: 'a' }] }, ana.token);
  await pedir(arm, '/api/sincronizar', { itens: [item('item-do-beto', 'Renovar CNH')] }, beto.token);

  const daAna = await pedir(arm, '/api/sincronizar', {}, ana.token);
  const doBeto = await pedir(arm, '/api/sincronizar', {}, beto.token);
  assert.deepEqual(daAna.itens.map(i => i.id), ['item-da-ana']);
  assert.deepEqual(doBeto.itens.map(i => i.id), ['item-do-beto']);
  assert.equal(doBeto.gastos.length, 0);
  assert.deepEqual(daAna.conta, { nome: 'ana', dono: true });
  assert.deepEqual(doBeto.conta, { nome: 'beto', dono: false });

  // o Apple Pay de cada um cai na conta certa
  const urlBeto = (await pedir(arm, '/api/atalho', {}, beto.token)).url;
  await pedir(arm, new URL(urlBeto).pathname, { valor: '12,00', local: 'Padaria', cartao: 'Inter' });
  assert.equal((await pedir(arm, '/api/sincronizar', {}, beto.token)).gastos.length, 1);
  assert.equal((await pedir(arm, '/api/sincronizar', {}, ana.token)).gastos.length, 1);

  // token inventado com o id de outra conta não entra
  const idDoBeto = beto.token.split('.')[0];
  assert.equal((await pedir(arm, '/api/sincronizar', {}, idDoBeto + '.' + ana.token.split('.')[1])).status, 401);
  assert.equal((await pedir(arm, '/api/sincronizar', {}, '../dados.x')).status, 401);
});

test('quem esqueceu a senha recebe uma provisória do dono e depois troca', async () => {
  const arm = memoria();
  const ana = await pedir(arm, '/api/criar-conta', { nome: 'Ana', senha: 'senha-ana' });
  const { convite } = await pedir(arm, '/api/pessoas', {}, ana.token);
  const beto = await pedir(arm, '/api/criar-conta', { nome: 'Beto', senha: 'senha-beto', convite: codigoDo(convite) });

  const { senha } = await pedir(arm, '/api/pessoas/senha', { nome: 'beto' }, ana.token);
  assert.match(senha, /^[a-z2-9]{4}-[a-z2-9]{4}$/);
  // os aparelhos do Beto saem; ele entra com a provisória
  assert.equal((await pedir(arm, '/api/sincronizar', {}, beto.token)).status, 401);
  const dentro = await pedir(arm, '/api/entrar', { nome: 'Beto', senha });
  assert.equal(dentro.status, 200);
  const outro = await pedir(arm, '/api/entrar', { nome: 'beto', senha });

  // troca a senha: este aparelho continua, o outro sai
  assert.equal((await pedir(arm, '/api/senha', { atual: 'errada', nova: 'nova-do-beto' }, dentro.token)).status, 403);
  assert.equal((await pedir(arm, '/api/senha', { atual: senha, nova: 'nova-do-beto' }, dentro.token)).status, 200);
  assert.equal((await pedir(arm, '/api/sincronizar', {}, dentro.token)).status, 200);
  assert.equal((await pedir(arm, '/api/sincronizar', {}, outro.token)).status, 401);
  assert.equal((await pedir(arm, '/api/entrar', { nome: 'beto', senha: 'nova-do-beto' })).status, 200);

  // o Beto não pode trocar a senha de ninguém
  assert.equal((await pedir(arm, '/api/pessoas/senha', { nome: 'ana' }, dentro.token)).status, 403);
});

test('os dados de antes das contas viram a conta do dono, sem tirar ninguém do app', async () => {
  const tokenAntigo = 'token-antigo-do-iphone-0123456789';
  const dados = dadosIniciais();
  dados.itens = [item('item-antigo', 'Pagar internet')];
  const arm = memoria({
    acesso: { senha: await hashSenha('senha-antiga'), sessoes: [{ hash: hashToken(tokenAntigo), criado_em: new Date().toISOString() }], atalho: 'segredo-antigo-do-atalho-123456' },
    dados,
    push: [{ endpoint: 'https://push.apple.com/x', keys: { p256dh: 'p', auth: 'a' } }],
    avisos: { enviados: { x: '2026-11-03' }, ultimo_dia: '2026-11-03' },
    'copia-2026-11-03': { dados },
    'entrada-gasto-1': { id: 'gasto-pendente-1', valor: 990, descricao: 'Café', cartao: 'Nubank', data: '2026-11-04', origem: 'applepay', forma: 'credito', apagado: false, criado_em: 'a', atualizado_em: 'a' },
    chaves: { publica: 'pub', privada: 'priv' }
  });

  // duas coisas chegando juntas na primeira vez não criam duas contas
  const [sinc] = await Promise.all([pedir(arm, '/api/sincronizar', {}, tokenAntigo), pedir(arm, '/api/estado')]);
  assert.equal(sinc.status, 200);
  assert.deepEqual(sinc.itens.map(i => i.id), ['item-antigo']);
  assert.deepEqual(sinc.gastos.map(g => g.id), ['gasto-pendente-1']);
  assert.deepEqual(sinc.conta, { nome: 'moises', dono: true });

  const raiz = [...arm.m.keys()].filter(k => !k.startsWith('u-')).sort();
  assert.deepEqual(raiz, [chaveAtalho('segredo-antigo-do-atalho-123456'), 'chaves', 'conta-moises', 'legado']);
  const u = armazemDe(arm, (await arm.ler('conta-moises')).id);
  assert.equal((await u.ler('push')).length, 1);
  assert.equal((await u.ler('avisos')).ultimo_dia, '2026-11-03');
  assert.deepEqual(await u.listar('copia-'), ['copia-2026-11-03']);

  // o mesmo endereço do Apple Pay continua valendo
  assert.equal((await pedir(arm, '/api/gasto/segredo-antigo-do-atalho-123456', { valor: '5,00', local: 'Banca' })).status, 200);
  // e dá para entrar com "Moisés" e a senha de sempre
  assert.equal((await pedir(arm, '/api/entrar', { nome: 'Moisés', senha: 'senha-antiga' })).status, 200);
  assert.equal((await pedir(arm, '/api/entrar', { nome: 'Moisés', senha: 'outra' })).status, 401);
});

test('a rodada de hora em hora faz a cópia de cada conta', async () => {
  const arm = memoria();
  const ana = await pedir(arm, '/api/criar-conta', { nome: 'Ana', senha: 'senha-ana' });
  const { convite } = await pedir(arm, '/api/pessoas', {}, ana.token);
  await pedir(arm, '/api/criar-conta', { nome: 'Beto', senha: 'senha-beto', convite: codigoDo(convite) });
  const r = await rodadaDeTodos(arm, { agora: new Date('2026-11-04T15:00:00Z'), site: 'https://camarada.test' });
  assert.deepEqual(Object.keys(r).sort(), ['ana', 'beto']);
  assert.equal(r.ana.copia.copia, 'copia-2026-11-04');
  assert.equal(r.beto.avisos.feito, true);
  assert.equal(arm.m.has('copia-2026-11-04'), false);
  assert.equal([...arm.m.keys()].filter(k => k.endsWith('-copia-2026-11-04')).length, 2);
});
