import test from 'node:test';
import assert from 'node:assert/strict';
import { nomeDeEntrada, emailDeEntrada, senhaProvisoria, DOMINIO_CONTAS } from '../web/lib/contas.js';
import { conferirSenhaAntiga, resumoAtalhoAntigo } from '../supabase/functions/_shared/senha-antiga.js';
import { hashSenha } from '../antigo/servidor/nucleo.js';
import { nomeDeEntrada as nomeAntigo, chaveAtalho } from '../antigo/servidor/contas.js';

test('nome de entrada igual ao do app antigo', () => {
  for (const n of ['Moisés', ' MOISÉS ', 'João Silva', 'ana--maria!', 'Çá ê', '', 'x'.repeat(40)]) {
    assert.equal(nomeDeEntrada(n), nomeAntigo(n), n);
  }
  assert.equal(nomeDeEntrada('João Silva'), 'joao-silva');
});

test('e-mail de entrada: nome vira e-mail interno; e-mail continua e-mail', () => {
  assert.equal(emailDeEntrada('Moisés'), `moises@${DOMINIO_CONTAS}`);
  assert.equal(emailDeEntrada(' Ana@Exemplo.com '), 'ana@exemplo.com');
  assert.equal(emailDeEntrada('  '), '');
});

test('senha provisória: 8 caracteres fáceis de ditar', () => {
  const s = senhaProvisoria();
  assert.match(s, /^[a-z2-9]{4}-[a-z2-9]{4}$/);
  assert.doesNotMatch(s, /[01ilo]/);
});

test('confere a senha guardada pelo app antigo', async () => {
  const guardado = await hashSenha('minha senha 123');
  assert.equal(await conferirSenhaAntiga('minha senha 123', guardado), true);
  assert.equal(await conferirSenhaAntiga('minha senha 124', guardado), false);
  assert.equal(await conferirSenhaAntiga('x', 'lixo'), false);
  assert.equal(await conferirSenhaAntiga('x', null), false);
});

test('endereço antigo do Apple Pay: mesmo resumo do app antigo', () => {
  const segredo = 'abcDEF_123-xyzxyzxyzxyz';
  assert.equal(`atalho-${resumoAtalhoAntigo(segredo)}`, chaveAtalho(segredo));
});
