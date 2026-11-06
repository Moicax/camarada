// Contas do Camarada: cada pessoa entra com o próprio nome e senha e só enxerga os próprios dados.
// Os dados de uma conta ficam com o prefixo "u-<id>-" (u-<id>-dados, u-<id>-push, u-<id>-copia-<dia>...).
// Do app todo: "conta-<nome>" (qual id é de quem), "atalho-<hash>" (endereço do Apple Pay → conta),
// "convite" (link para criar conta), "chaves" (das notificações) e "legado".
import crypto from 'node:crypto';
import { dadosIniciais, hashSenha } from './nucleo.js';

const ID_CONTA = /^[a-f0-9]{16}$/;
// Quem já usava o app antes das contas vira esta conta, com a mesma senha.
export const NOME_DO_DONO = 'moises';

export const idValido = id => typeof id === 'string' && ID_CONTA.test(id);

// "Moisés", "moises" e " MOISÉS " entram na mesma conta. Espaços viram hífen: "João Silva" → joao-silva.
export function nomeDeEntrada(nome) {
  return String(nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 30).replace(/-+$/, '');
}

// Mesmo formato do armazém de sempre, mas preso aos dados de uma conta.
// "raiz" é o armazém do app todo (as chaves das notificações moram lá).
export function armazemDe(base, id) {
  if (!idValido(id)) throw new Error('conta inválida');
  const pre = `u-${id}-`;
  return {
    raiz: base,
    ler: (nome, padrao) => base.ler(pre + nome, padrao),
    gravar: (nome, obj) => base.gravar(pre + nome, obj),
    listar: async prefixo => (await base.listar(pre + prefixo)).map(n => n.slice(pre.length)),
    apagar: nome => base.apagar(pre + nome)
  };
}

// O endereço do Apple Pay aponta para a conta pelo resumo do segredo, nunca pelo segredo em si.
export const chaveAtalho = segredo => 'atalho-' + crypto.createHash('sha256').update(String(segredo)).digest('hex').slice(0, 40);

export async function contaPorNome(armazem, nome) {
  const login = nomeDeEntrada(nome);
  if (!login) return null;
  const indice = await armazem.ler('conta-' + login, null);
  if (!idValido(indice?.id)) return null;
  const u = armazemDe(armazem, indice.id);
  const acesso = await u.ler('acesso', null);
  return acesso ? { id: indice.id, u, acesso } : null;
}

export async function listarContas(armazem) {
  const nomes = await armazem.listar('conta-');
  const lidas = await Promise.all(nomes.map(async n => ({ login: n.slice('conta-'.length), id: (await armazem.ler(n, null))?.id })));
  return lidas.filter(c => idValido(c.id));
}

// Cria a conta já com os dados iniciais. O índice "conta-<nome>" é gravado por último:
// até lá, ninguém entra numa conta pela metade.
export async function criarConta(armazem, { nome, senha, dono = false, agora = new Date() }) {
  const login = nomeDeEntrada(nome);
  const id = crypto.randomBytes(8).toString('hex');
  const u = armazemDe(armazem, id);
  const dados = dadosIniciais(agora);
  const primeiroNome = String(nome).trim().split(/\s+/)[0];
  if (primeiroNome) dados.preferencias.apelido = primeiroNome.slice(0, 30);
  await u.gravar('dados', dados);
  await u.gravar('acesso', { login, senha: await hashSenha(senha), dono, sessoes: [], criado_em: agora.toISOString() });
  await armazem.gravar('conta-' + login, { id });
  return { id, u, login };
}

// Até 04/11/2026 o app era de uma pessoa só, com os dados soltos ("dados", "acesso", "push"...).
// Na primeira vez que esta versão roda, eles viram a conta do dono, com a mesma senha, e quem
// já estava dentro continua dentro. Pode rodar duas vezes ao mesmo tempo sem estragar nada:
// o id sai da própria senha antiga e nada que já está na conta é sobrescrito.
const SOLTOS = ['dados', 'push', 'avisos'];
const jaVistos = new WeakSet();
export async function migrarContaUnica(armazem, nome = NOME_DO_DONO) {
  if (jaVistos.has(armazem)) return null;
  const acesso = await armazem.ler('acesso', null);
  if (!acesso?.senha) { jaVistos.add(armazem); return null; }

  const id = crypto.createHash('sha256').update('legado:' + acesso.senha).digest('hex').slice(0, 16);
  const u = armazemDe(armazem, id);
  const avulsos = [...await armazem.listar('copia-'), ...await armazem.listar('entrada-')];
  for (const n of [...SOLTOS, ...avulsos]) {
    const valor = await armazem.ler(n, null);
    if (valor != null && (await u.ler(n, null)) == null) await u.gravar(n, valor);
  }
  const login = nomeDeEntrada(nome);
  if ((await u.ler('acesso', null)) == null) {
    await u.gravar('acesso', { login, senha: acesso.senha, dono: true, sessoes: acesso.sessoes || [], atalho: acesso.atalho || null, criado_em: new Date().toISOString() });
  }
  if (acesso.atalho) await armazem.gravar(chaveAtalho(acesso.atalho), { id });
  await armazem.gravar('legado', { id });
  if (!(await armazem.ler('conta-' + login, null))) await armazem.gravar('conta-' + login, { id });
  // "acesso" sai por último: enquanto ele existir, a migração ainda não terminou
  for (const n of [...SOLTOS, ...avulsos]) await armazem.apagar(n);
  await armazem.apagar('acesso');
  jaVistos.add(armazem);
  return { id, login };
}
