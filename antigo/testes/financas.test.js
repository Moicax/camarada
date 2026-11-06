import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valorEmCentavos, reais, resumoDoMes, cartaoNaLista } from '../app/regras.js';
import { tratar } from '../servidor/rotas.js';
import { dadosIniciais, mesclar } from '../servidor/nucleo.js';
import { fazerCopia } from '../servidor/avisos.js';
import { armazemDe } from '../servidor/contas.js';

// Armazém em memória, no mesmo formato do de arquivos e do Netlify.
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
const pedir = (armazem, caminho, corpo, token) => tratar(new Request('https://camarada.test' + caminho, {
  method: corpo === undefined ? 'GET' : 'POST',
  headers: token ? { Authorization: 'Bearer ' + token } : {},
  body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
}), armazem, { site: 'https://camarada.test' });

// Primeira conta, criada pela API. "u" são os dados dessa conta.
async function novaConta() {
  const armazem = memoria();
  const { token } = await (await pedir(armazem, '/api/criar-conta', { nome: 'Ana', senha: 'teste-123' })).json();
  return { armazem, token, u: armazemDe(armazem, token.split('.')[0]) };
}

test('valor do Apple Pay em vários formatos', () => {
  assert.equal(valorEmCentavos('R$ 1.234,56'), 123456);
  assert.equal(valorEmCentavos('R$ 12,90'), 1290);
  assert.equal(valorEmCentavos('12.90'), 1290);
  assert.equal(valorEmCentavos('1.234'), 123400);
  assert.equal(valorEmCentavos(45), 4500);
  assert.equal(valorEmCentavos(''), null);
  assert.equal(reais(123456), 'R$ 1.234,56');
});

test('resumo do mês: sobra e quanto dá por dia', () => {
  const g = [{ valor: 100000, data: '2026-11-01', cartao: 'Nubank' }, { valor: 50000, data: '2026-11-03', cartao: 'Inter' }, { valor: 9999, data: '2026-10-31' }, { valor: 7000, data: '2026-11-02', apagado: true }];
  const r = resumoDoMes(g, '2026-11', 500000, '2026-11-21');
  assert.equal(r.total, 150000);
  assert.equal(r.sobra, 350000);
  assert.equal(r.diasRestantes, 10);
  assert.equal(r.porDia, 35000);
  assert.deepEqual(r.porCartao.map(c => c.cartao), ['Nubank', 'Inter']);
  assert.equal(resumoDoMes(g, '2026-10', 500000, '2026-11-21').porDia, null);
});

test('crédito separado do que sai do salário na hora', () => {
  const g = [
    { valor: 20000, data: '2026-11-02', forma: 'credito' },
    { valor: 5000, data: '2026-11-03', forma: 'avista' },
    { valor: 1000, data: '2026-11-03' } // sem forma = crédito (Apple Pay)
  ];
  const r = resumoDoMes(g, '2026-11', 300000, '2026-11-04');
  assert.equal(r.avista, 5000);
  assert.equal(r.credito, 21000);
  assert.equal(r.saldo, 295000);
  assert.equal(r.sobra, 274000);
});

test('faturas do mês só somam o crédito', () => {
  const g = [
    { valor: 8740, data: '2026-11-04', cartao: 'Nubank', forma: 'credito' },
    { valor: 4590, data: '2026-11-04', cartao: 'Inter', forma: 'avista' },
    { valor: 1000, data: '2026-11-04', cartao: 'Inter', forma: 'credito' }
  ];
  const r = resumoDoMes(g, '2026-11', 0, '2026-11-04');
  assert.deepEqual(r.porCartao.map(c => [c.cartao, c.total, c.qtd]), [['Nubank', 8740, 1], ['Inter', 1000, 1]]);
});

test('nome do cartão é comparado sem diferença de maiúscula e espaço', () => {
  assert.equal(cartaoNaLista(' nubank ', ['Nubank']), true);
  assert.equal(cartaoNaLista('Inter', ['Nubank']), false);
  assert.equal(cartaoNaLista('', ['']), false);
});

test('gastos entram na sincronização e lixo é ignorado', () => {
  const dados = dadosIniciais();
  delete dados.gastos;
  mesclar(dados, { gastos: [
    { id: 'gasto-0001', valor: 1290, descricao: 'Padaria', cartao: 'Nubank', data: '2026-11-04', atualizado_em: 'a' },
    { id: 'gasto-0002', valor: -5, atualizado_em: 'a' },
    { id: 'gasto-0003', valor: '12', atualizado_em: 'a' }
  ] });
  assert.equal(dados.gastos.length, 1);
  assert.equal(dados.gastos[0].origem, 'manual');
});

test('Atalhos do iPhone lança o gasto pelo endereço secreto', async () => {
  const { armazem, token, u } = await novaConta();

  const { url } = await (await pedir(armazem, '/api/atalho', {}, token)).json();
  const caminho = new URL(url).pathname;
  assert.match(caminho, /^\/api\/gasto\/[\w-]{20,}$/);

  // sem a chave certa: nada entra
  assert.equal((await pedir(armazem, '/api/gasto/chave-errada-chave-errada-123', { valor: 'R$ 5,00' })).status, 404);

  const r = await pedir(armazem, caminho, { valor: 'R$ 1.234,56', local: 'Mercado Bom Preço', cartao: 'Nubank' });
  assert.equal(r.status, 200);
  // o gasto fica na caixa de entrada até o app sincronizar
  assert.equal((await u.listar('entrada-')).length, 1);
  assert.equal((await u.ler('dados')).gastos.length, 0);

  const sinc = await (await pedir(armazem, '/api/sincronizar', {}, token)).json();
  assert.equal(sinc.gastos.length, 1);
  const g = sinc.gastos[0];
  assert.equal(g.valor, 123456);
  assert.equal(g.descricao, 'Mercado Bom Preço');
  assert.equal(g.cartao, 'Nubank');
  assert.equal(g.origem, 'applepay');
  assert.equal(g.forma, 'credito');
  assert.equal((await u.listar('entrada-')).length, 0);
  assert.equal((await u.ler('dados')).gastos.length, 1);

  // valor que não dá para entender
  assert.equal((await pedir(armazem, caminho, { valor: 'abc' })).status, 400);

  // trocar o endereço desliga o antigo
  const { url: novo } = await (await pedir(armazem, '/api/atalho', { novo: true }, token)).json();
  assert.notEqual(novo, url);
  assert.equal((await pedir(armazem, caminho, { valor: '10' })).status, 404);

  // sem senha não dá para pedir o endereço
  assert.equal((await pedir(armazem, '/api/atalho', {})).status, 401);
});

test('gasto que chega enquanto o app grava não se perde', async () => {
  const { armazem, token } = await novaConta();
  const { url } = await (await pedir(armazem, '/api/atalho', {}, token)).json();
  const caminho = new URL(url).pathname;
  // o app sincroniza e o Atalhos manda dois gastos ao mesmo tempo
  await Promise.all([
    pedir(armazem, '/api/sincronizar', { gastos: [{ id: 'gasto-manual-1', valor: 500, descricao: 'Café', data: '2026-11-04', atualizado_em: 'a' }] }, token),
    pedir(armazem, caminho, { valor: '10,00', local: 'Padaria', cartao: 'Nubank' }),
    pedir(armazem, caminho, { valor: '20,00', local: 'Farmácia', cartao: 'Nubank' })
  ]);
  const sinc = await (await pedir(armazem, '/api/sincronizar', {}, token)).json();
  assert.deepEqual(sinc.gastos.map(g => g.valor).sort((a, b) => a - b), [500, 1000, 2000]);
});

test('cartão marcado como débito entra como à vista', async () => {
  const { armazem, token, u } = await novaConta();
  const prefs = { ...(await u.ler('dados')).preferencias, debito: ['Inter Débito'], atualizado_em: '9999' };
  await pedir(armazem, '/api/sincronizar', { preferencias: prefs }, token);
  const { url } = await (await pedir(armazem, '/api/atalho', {}, token)).json();
  await pedir(armazem, new URL(url).pathname, { valor: '30,00', local: 'Mercado', cartao: 'inter débito' });
  await pedir(armazem, new URL(url).pathname, { valor: '40,00', local: 'Posto', cartao: 'Nubank' });
  const sinc = await (await pedir(armazem, '/api/sincronizar', {}, token)).json();
  const forma = Object.fromEntries(sinc.gastos.map(g => [g.descricao, g.forma]));
  assert.deepEqual(forma, { Mercado: 'avista', Posto: 'credito' });
});

test('senha: só trava depois de 20 erros seguidos', async () => {
  const { armazem, u } = await novaConta();
  const entrar = () => pedir(armazem, '/api/entrar', { nome: 'ana', senha: 'teste-123' });
  await u.gravar('acesso', { ...(await u.ler('acesso')), erros: { n: 19, ultimo: Date.now() } });
  // 19 erros: ainda deixa entrar com a senha certa, e zera a conta
  assert.equal((await entrar()).status, 200);
  assert.equal((await u.ler('acesso')).erros, undefined);
  // 20 erros recentes: espera, mesmo com a senha certa
  await u.gravar('acesso', { ...(await u.ler('acesso')), erros: { n: 20, ultimo: Date.now() } });
  assert.equal((await entrar()).status, 429);
  // passados os 15 minutos, volta a funcionar
  await u.gravar('acesso', { ...(await u.ler('acesso')), erros: { n: 20, ultimo: Date.now() - 16 * 60e3 } });
  assert.equal((await entrar()).status, 200);
});

test('cópia de segurança: uma por dia, guarda 14', async () => {
  const armazem = memoria({ dados: dadosIniciais() });
  for (let d = 1; d <= 20; d++) await fazerCopia(armazem, new Date(Date.UTC(2026, 10, d, 15)));
  await fazerCopia(armazem, new Date(Date.UTC(2026, 10, 20, 18))); // mesma data: não duplica
  const copias = await armazem.listar('copia-');
  assert.equal(copias.length, 14);
  assert.equal(copias[0], 'copia-2026-11-07');
  assert.equal(copias.at(-1), 'copia-2026-11-20');
  assert.ok((await armazem.ler('copia-2026-11-20')).dados.categorias.length > 0);
});
