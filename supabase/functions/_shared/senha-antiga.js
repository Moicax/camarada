// Senha do app antigo: scrypt(senha, sal, 32), guardada como "salHex:hashHex" (servidor/nucleo.js de lá).
// Também o resumo do endereço secreto do Apple Pay, que aponta para a conta sem guardar o segredo.
import { scrypt, timingSafeEqual, createHash } from 'node:crypto';

const deHex = (h) => Uint8Array.from(String(h).match(/../g) ?? [], (b) => parseInt(b, 16));

export async function conferirSenhaAntiga(senha, guardado) {
  const [sal, hash] = String(guardado ?? '').split(':');
  if (!sal || !hash || !/^[0-9a-f]+$/.test(sal + hash)) return false;
  const calculado = await new Promise((ok, falha) =>
    scrypt(String(senha), deHex(sal), 32, (e, k) => (e ? falha(e) : ok(new Uint8Array(k)))));
  const esperado = deHex(hash);
  return esperado.length === calculado.length && timingSafeEqual(calculado, esperado);
}

export const resumoAtalhoAntigo = (segredo) => createHash('sha256').update(String(segredo)).digest('hex').slice(0, 40);
