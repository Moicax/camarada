import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abaDe, proximaData, prazoTexto, hojeIso, separar } from '../app/regras.js';
import { mesclar, dadosIniciais, conferirSenha, hashSenha } from '../servidor/nucleo.js';

const cats = [{ id: 'cat-contas', aviso_dias: 5 }, { id: 'cat-docs', aviso_dias: 45 }];
const H = '2026-11-03';

test('cada item cai em uma aba só', () => {
  assert.equal(abaDe({ concluido_em: H, data_limite: '2026-11-04' }, H, cats, 7), 'feitas');
  assert.equal(abaDe({ data_limite: null }, H, cats, 7), 'pendentes');
  assert.equal(abaDe({ data_limite: '2026-11-08', categoria_id: 'cat-contas' }, H, cats, 7), 'expirar');
  assert.equal(abaDe({ data_limite: '2026-11-09', categoria_id: 'cat-contas' }, H, cats, 7), 'pendentes');
  assert.equal(abaDe({ data_limite: '2026-12-18', categoria_id: 'cat-docs' }, H, cats, 7), 'expirar');
  assert.equal(abaDe({ data_limite: '2026-10-01', categoria_id: 'cat-contas' }, H, cats, 7), 'expirar');
  assert.equal(abaDe({ data_limite: '2026-11-10' }, H, cats, 7), 'expirar');
  assert.equal(abaDe({ data_limite: '2026-11-10', categoria_id: 'cat-docs', aviso_dias: 2 }, H, cats, 7), 'pendentes');
});

test('próxima ocorrência respeita fim de mês e ano bissexto', () => {
  assert.equal(proximaData('2026-11-03', 'semanal'), '2026-11-10');
  assert.equal(proximaData('2026-01-31', 'mensal', 31), '2026-02-28');
  assert.equal(proximaData('2026-02-28', 'mensal', 31), '2026-03-31');
  assert.equal(proximaData('2026-12-15', 'mensal'), '2027-01-15');
  assert.equal(proximaData('2028-02-29', 'anual', 29), '2029-02-28');
  assert.equal(proximaData('2029-02-28', 'anual', 29), '2030-02-28');
  assert.equal(proximaData('2026-11-03', null), null);
});

test('texto do prazo', () => {
  assert.deepEqual(prazoTexto({ data_limite: '2026-11-02' }, H, 5), { texto: 'venceu ontem', tom: 'late' });
  assert.deepEqual(prazoTexto({ data_limite: '2026-10-30' }, H, 5), { texto: 'venceu há 4 dias', tom: 'late' });
  assert.deepEqual(prazoTexto({ data_limite: H }, H, 5), { texto: 'vence hoje', tom: 'late' });
  assert.deepEqual(prazoTexto({ data_limite: '2026-11-04' }, H, 5), { texto: 'vence amanhã', tom: 'warn' });
  assert.deepEqual(prazoTexto({ data_limite: '2026-11-04' }, H, 0), { texto: 'vence amanhã', tom: '' });
  assert.deepEqual(prazoTexto({ data_limite: '2026-11-07' }, H, 5), { texto: 'vence em 4 dias', tom: 'warn' });
  assert.deepEqual(prazoTexto({ data_limite: '2026-11-30' }, H, 5), { texto: 'até 30/11', tom: '' });
  assert.deepEqual(prazoTexto({ concluido_em: '2026-11-01' }, H, 5), { texto: 'feito 01/11', tom: 'ok' });
  // sem data: nada escrito
  assert.deepEqual(prazoTexto({ data_limite: null }, H, 5), { texto: '', tom: '' });
});

test('laranja só quando faltam 7 dias ou menos', () => {
  // CNH com janela de 45 dias: está em A expirar, mas a 37 dias não é urgente
  assert.deepEqual(prazoTexto({ data_limite: '2026-12-10' }, H, 45), { texto: 'vence em 37 dias', tom: '' });
  assert.deepEqual(prazoTexto({ data_limite: '2026-11-10' }, H, 45), { texto: 'vence em 7 dias', tom: 'warn' });
  assert.deepEqual(prazoTexto({ data_limite: '2026-11-11' }, H, 45), { texto: 'vence em 8 dias', tom: '' });
});

test('prazo com hora: hoje e amanhã dizem a hora, do jeito falado', () => {
  assert.deepEqual(prazoTexto({ data_limite: H, hora: '18:00' }, H, 5), { texto: 'vence hoje às 18h', tom: 'late' });
  assert.deepEqual(prazoTexto({ data_limite: '2026-11-04', hora: '09:30' }, H, 5), { texto: 'vence amanhã às 9h30', tom: 'warn' });
  assert.deepEqual(prazoTexto({ data_limite: '2026-11-07', hora: '09:30' }, H, 5), { texto: 'vence em 4 dias', tom: 'warn' });
  // no mesmo dia, a de hora mais cedo vem antes; sem hora, no fim do dia
  const g = separar([
    { id: 'sem-hora', data_limite: H, criado_em: '1' },
    { id: 'tarde', data_limite: H, hora: '18:00', criado_em: '2' },
    { id: 'manha', data_limite: H, hora: '08:00', criado_em: '3' }
  ], H, cats, 7);
  assert.deepEqual(g.expirar.map(i => i.id), ['manha', 'tarde', 'sem-hora']);
});

test('hora só é guardada junto com a data', () => {
  const dados = dadosIniciais(new Date('2026-11-03T10:00:00Z'));
  mesclar(dados, { itens: [
    { id: 'item-com-hora', data_limite: H, hora: '18:30', atualizado_em: 'a' },
    { id: 'item-sem-data', data_limite: null, hora: '18:30', atualizado_em: 'a' },
    { id: 'item-hora-ruim', data_limite: H, hora: '25:00', atualizado_em: 'a' }
  ] });
  assert.deepEqual(dados.itens.map(i => i.hora), ['18:30', null, null]);
});

test('dia de hoje no fuso de São Paulo, perto da meia-noite', () => {
  assert.equal(hojeIso(new Date('2026-11-04T02:30:00Z'), 'America/Sao_Paulo'), '2026-11-03');
  assert.equal(hojeIso(new Date('2026-11-04T03:30:00Z'), 'America/Sao_Paulo'), '2026-11-04');
});

test('separar ordena vencidos primeiro e ignora apagados', () => {
  const itens = [
    { id: 'a', data_limite: '2026-11-06', categoria_id: 'cat-contas', criado_em: '1' },
    { id: 'b', data_limite: '2026-11-01', categoria_id: 'cat-contas', criado_em: '2' },
    { id: 'c', data_limite: null, criado_em: '3' },
    { id: 'd', data_limite: '2026-11-04', apagado: true, criado_em: '4' }
  ];
  const g = separar(itens, H, cats, 7);
  assert.deepEqual(g.expirar.map(i => i.id), ['b', 'a']);
  assert.deepEqual(g.pendentes.map(i => i.id), ['c']);
});

test('sincronização: vale a edição mais recente e lixo é ignorado', () => {
  const dados = dadosIniciais(new Date('2026-11-03T10:00:00Z'));
  const base = { id: 'item-0001', titulo: 'Pagar luz', data_limite: '2026-11-10', atualizado_em: '2026-11-03T10:00:00.000Z' };
  mesclar(dados, { itens: [base] });
  mesclar(dados, { itens: [{ ...base, titulo: 'Velho', atualizado_em: '2026-11-03T09:00:00.000Z' }] });
  assert.equal(dados.itens[0].titulo, 'Pagar luz');
  mesclar(dados, { itens: [{ ...base, titulo: 'Novo', atualizado_em: '2026-11-03T11:00:00.000Z' }] });
  assert.equal(dados.itens[0].titulo, 'Novo');
  mesclar(dados, { itens: [{ id: '../x', atualizado_em: 'z' }, { id: 'item-0002', data_limite: '3/11', atualizado_em: 'z', extra: 1 }] });
  assert.equal(dados.itens.length, 2);
  assert.equal(dados.itens[1].data_limite, null);
  assert.equal('extra' in dados.itens[1], false);
});

test('aparência é guardada e valor estranho vira claro', () => {
  const dados = dadosIniciais(new Date('2026-11-03T10:00:00Z'));
  mesclar(dados, { preferencias: { ...dados.preferencias, tema: 'escuro', atualizado_em: '2026-11-03T11:00:00.000Z' } });
  assert.equal(dados.preferencias.tema, 'escuro');
  mesclar(dados, { preferencias: { ...dados.preferencias, tema: 'roxo', atualizado_em: '2026-11-03T12:00:00.000Z' } });
  assert.equal(dados.preferencias.tema, 'claro');
});

test('apagados somem depois de 90 dias', () => {
  const dados = dadosIniciais();
  mesclar(dados, { itens: [{ id: 'item-velho', apagado: true, atualizado_em: '2026-01-01T00:00:00.000Z' }] }, Date.parse('2026-11-03T00:00:00Z'));
  assert.equal(dados.itens.length, 0);
});

test('senha', async () => {
  const h = await hashSenha('teste-123');
  assert.equal(await conferirSenha('teste-123', h), true);
  assert.equal(await conferirSenha('outra', h), false);
});
