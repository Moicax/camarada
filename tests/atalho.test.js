import test from 'node:test';
import assert from 'node:assert/strict';
import { textoDaAutomacao, situacaoDoAtalho, quandoFoi } from '../web/lib/atalho.js';

const URL = 'https://exemplo.supabase.co/functions/v1/registrar-compra';
const CODIGO = 'a'.repeat(48);

test('texto pronto da automação: endereço, código e os 4 campos com as variáveis certas', () => {
  const t = textoDaAutomacao(URL, CODIGO);
  assert.ok(t.includes(`URL: ${URL}`));
  assert.ok(t.includes(`token = o texto fixo ${CODIGO}`));
  assert.ok(t.includes('Método: POST') && t.includes('Pedir Corpo: JSON'));
  assert.ok(t.includes('valor = a propriedade "Valor"'));
  assert.ok(t.includes('comerciante = a propriedade "Comerciante"'));
  assert.ok(t.includes('cartao = a propriedade "Cartão ou Tíquete"'));
  assert.ok(t.includes('"Conteúdos do URL"'));
  assert.ok(!t.includes('COLE-AQUI'), 'o código da pessoa já vem dentro');
});

test('quando foi: hoje, ontem ou a data', () => {
  const agora = new Date(2026, 10, 6, 15, 0);
  assert.equal(quandoFoi(new Date(2026, 10, 6, 12, 7), agora), 'hoje às 12:07');
  assert.equal(quandoFoi(new Date(2026, 10, 5, 18, 30), agora), 'ontem às 18:30');
  assert.equal(quandoFoi(new Date(2026, 10, 1, 9, 5), agora), '01/11 às 09:05');
});

test('situação: aguardando, conectado e o que corrigir', () => {
  const agora = new Date(2026, 10, 6, 15, 0);
  const em = (h, m) => new Date(2026, 10, 6, h, m).toISOString();
  assert.equal(situacaoDoAtalho({ tentativa: null, temCompras: false }, agora).tom, 'espera');
  assert.equal(situacaoDoAtalho({ tentativa: null, temCompras: true }, agora).tom, 'ok');
  const ok = situacaoDoAtalho({ tentativa: { criado_em: em(12, 7), status: 200 }, temCompras: true }, agora);
  assert.equal(ok.tom, 'ok');
  assert.match(ok.texto, /hoje às 12:07/);
  const semValor = situacaoDoAtalho({ tentativa: { criado_em: em(12, 7), status: 400, motivo: 'valor' }, temCompras: false }, agora);
  assert.equal(semValor.tom, 'aviso');
  assert.match(semValor.texto, /variável Valor/);
  assert.equal(situacaoDoAtalho({ tentativa: { criado_em: em(12, 7), status: 500 }, temCompras: true }, agora).tom, 'aviso');
});
