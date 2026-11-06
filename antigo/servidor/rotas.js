// Rotas da API do Camarada. Recebem um Request e devolvem um Response (padrão da web),
// então o mesmo código roda no PC (servidor.js) e na nuvem (netlify/functions/api.mjs).
// Cada pessoa tem a sua conta: depois de entrar, tudo lê e grava só nos dados dela (armazemDe).
import crypto from 'node:crypto';
import { dadosIniciais, mesclar, paraEnvio, hashSenha, conferirSenha, hashToken, limparGasto } from './nucleo.js';
import { chavesPush, inscreverPush, cancelarPush, enviarTeste, avisarNoCelular } from './avisos.js';
import { armazemDe, contaPorNome, criarConta, listarContas, migrarContaUnica, nomeDeEntrada, chaveAtalho, idValido } from './contas.js';
import { valorEmCentavos, hojeIso, resumoDoMes, reais, cartaoNaLista } from '../app/regras.js';

const FUSO = 'America/Sao_Paulo';
const ROTA_GASTO = /^\/api\/gasto\/([\w-]{20,80})$/;
// Gastos do Atalhos ficam cada um no seu arquivo até o app sincronizar: assim nunca se perdem
// se chegarem no mesmo instante em que o app está gravando.
const ENTRADA = 'entrada-';

const VALIDADE_SESSAO = 400 * 864e5;
const MAX_SESSOES = 20;
const LIMITE_CORPO = 2e6;
const SENHA_MINIMA = 6;
// 1 segundo de pausa por senha errada. Só depois de 20 erros seguidos pede para esperar 15 minutos:
// quem digita errado de verdade nunca chega lá, e quem tenta adivinhar no automático fica travado.
const PAUSA_SENHA_ERRADA = 1000;
const ERROS_ATE_ESPERAR = 20;
const ESPERA_SENHA = 15 * 60e3;

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const falha = (status, msg) => Object.assign(new Error(msg), { status });
const pausa = () => new Promise(ok => setTimeout(ok, PAUSA_SENHA_ERRADA));

async function lerCorpo(req) {
  const texto = await req.text();
  if (texto.length > LIMITE_CORPO) throw falha(413, 'Envio grande demais.');
  if (!texto) return {};
  try { return JSON.parse(texto); } catch { throw falha(400, 'Pedido inválido.'); }
}

// O token começa com o id da conta ("<id>.<segredo>"). Token sem ponto é de antes das contas: é do dono.
async function sessaoDe(req, armazem) {
  const m = /^Bearer (\S+)$/.exec(req.headers.get('authorization') || '');
  if (!m) return null;
  const ponto = m[1].indexOf('.');
  const id = ponto > 0 ? m[1].slice(0, ponto) : (await armazem.ler('legado', null))?.id;
  if (!idValido(id)) return null;
  const u = armazemDe(armazem, id);
  const acesso = await u.ler('acesso', null);
  const hash = hashToken(m[1]);
  const sessao = acesso?.sessoes?.find(s => s.hash === hash && Date.now() - Date.parse(s.criado_em) < VALIDADE_SESSAO);
  return sessao ? { id, u, acesso, sessao } : null;
}

async function abrirSessao(id, u, acesso) {
  const token = `${id}.${crypto.randomBytes(32).toString('base64url')}`;
  acesso.sessoes = [...(acesso.sessoes || []), { hash: hashToken(token), criado_em: new Date().toISOString() }].slice(-MAX_SESSOES);
  await u.gravar('acesso', acesso);
  return token;
}

export async function tratar(req, armazem, { site } = {}) {
  try {
    await migrarContaUnica(armazem);
    return await rotear(req, armazem, site || new URL(req.url).origin);
  } catch (e) {
    if (!e.status) console.error(e);
    return json(e.status || 500, { erro: e.status ? e.message : 'Erro no servidor.' });
  }
}

async function rotear(req, armazem, site) {
  const rota = new URL(req.url).pathname;

  if (req.method === 'GET') {
    // "primeira": ainda não existe conta nenhuma, então a tela abre em Criar conta, sem convite.
    if (rota === '/api/estado') return json(200, { primeira: !(await armazem.listar('conta-')).length });
    if (rota === '/api/push-chave') return json(200, { chave: (await chavesPush(armazem)).publica });
    return json(404, { erro: 'Endereço não encontrado.' });
  }
  if (req.method !== 'POST') return json(405, { erro: 'Método não permitido.' });

  // Compra no Apple Pay: o Atalhos do iPhone chama este endereço secreto. Não usa a senha.
  const mGasto = ROTA_GASTO.exec(rota);
  if (mGasto) return receberGastoDoAtalho(req, armazem, mGasto[1], site);

  const corpo = await lerCorpo(req);

  if (rota === '/api/criar-conta') return criarContaNova(armazem, corpo);
  if (rota === '/api/entrar') return entrar(armazem, corpo);

  const s = await sessaoDe(req, armazem);

  if (rota === '/api/sair') {
    if (s) { s.acesso.sessoes = s.acesso.sessoes.filter(x => x.hash !== s.sessao.hash); await s.u.gravar('acesso', s.acesso); }
    return json(200, { ok: true });
  }

  if (!s) return json(401, { erro: 'Sua entrada expirou. Entre de novo.' });
  const { id, u, acesso } = s;

  if (rota === '/api/sincronizar') {
    const dados = (await u.ler('dados', null)) || dadosIniciais();
    // junta o que o aparelho mandou com os gastos do Atalhos que estão na caixa de entrada
    const entradas = await lerEntradas(u);
    const gastos = [...(Array.isArray(corpo.gastos) ? corpo.gastos : []), ...entradas.map(e => e.gasto)];
    mesclar(dados, { ...corpo, gastos });
    await u.gravar('dados', dados);
    // só depois de gravado tira da caixa de entrada; se algo falhar antes, eles entram na próxima vez
    for (const e of entradas) await u.apagar(e.nome);
    return json(200, { ...paraEnvio(dados), conta: { nome: acesso.login, dono: acesso.dono === true } });
  }
  if (rota === '/api/push-inscrever') { await inscreverPush(u, corpo.inscricao); return json(200, { ok: true }); }
  if (rota === '/api/push-cancelar') { await cancelarPush(u, String(corpo.endpoint || '')); return json(200, { ok: true }); }
  if (rota === '/api/avisos-teste') return json(200, await enviarTeste(u, site));

  // Endereço secreto para o Atalhos. "novo: true" troca o endereço e o antigo para de funcionar.
  if (rota === '/api/atalho') {
    if (!acesso.atalho || corpo.novo === true) {
      if (acesso.atalho) await armazem.apagar(chaveAtalho(acesso.atalho));
      acesso.atalho = crypto.randomBytes(24).toString('base64url');
      await u.gravar('acesso', acesso);
      await armazem.gravar(chaveAtalho(acesso.atalho), { id });
    }
    return json(200, { url: `${site}/api/gasto/${acesso.atalho}` });
  }

  if (rota === '/api/senha') return trocarSenha(s, corpo);

  if (rota === '/api/pessoas' || rota === '/api/pessoas/senha') {
    if (acesso.dono !== true) return json(403, { erro: 'Só quem cuida do app vê as pessoas.' });
    return rota === '/api/pessoas' ? pessoas(armazem, s, corpo, site) : novaSenhaDe(armazem, s, corpo);
  }

  return json(404, { erro: 'Endereço não encontrado.' });
}

const mesmaChave = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/* ---------- contas ---------- */

// A primeira conta não precisa de convite e cuida do app. As outras só nascem pelo link de convite.
async function criarContaNova(armazem, corpo) {
  const nome = String(corpo.nome || '').trim().slice(0, 30);
  const senha = String(corpo.senha || '');
  const primeira = !(await armazem.listar('conta-')).length;
  if (!primeira) {
    const convite = await armazem.ler('convite', null);
    if (!convite?.codigo || !mesmaChave(String(corpo.convite || ''), convite.codigo)) {
      await pausa();
      return json(403, { erro: 'Para criar uma conta, abra o link de convite que mandaram para você.' });
    }
  }
  const login = nomeDeEntrada(nome);
  if (login.length < 2) return json(400, { erro: 'Escreva o seu nome.' });
  if (senha.length < SENHA_MINIMA) return json(400, { erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  if (await armazem.ler('conta-' + login, null)) return json(409, { erro: 'Já existe uma conta com esse nome. Use outro, como nome e sobrenome.' });
  const { id, u } = await criarConta(armazem, { nome, senha, dono: primeira });
  return json(200, { token: await abrirSessao(id, u, await u.ler('acesso')) });
}

async function entrar(armazem, corpo) {
  const conta = await contaPorNome(armazem, corpo.nome);
  if (!conta) { await pausa(); return json(401, { erro: 'Nome ou senha não conferem. Confira e tente de novo.' }); }
  const { id, u, acesso } = conta;
  const erros = acesso.erros || { n: 0, ultimo: 0 };
  const travado = erros.n >= ERROS_ATE_ESPERAR && Date.now() - erros.ultimo < ESPERA_SENHA;
  if (travado) return json(429, { erro: 'Muitas senhas erradas seguidas. Espere 15 minutos e tente de novo.' });
  if (!(await conferirSenha(String(corpo.senha || ''), acesso.senha))) {
    acesso.erros = { n: (erros.n >= ERROS_ATE_ESPERAR ? 0 : erros.n) + 1, ultimo: Date.now() };
    await u.gravar('acesso', acesso);
    await pausa();
    return json(401, { erro: 'Nome ou senha não conferem. Confira e tente de novo.' });
  }
  delete acesso.erros;
  return json(200, { token: await abrirSessao(id, u, acesso) });
}

// Troca a própria senha. Este aparelho continua dentro; os outros pedem a senha nova.
async function trocarSenha({ u, acesso, sessao }, corpo) {
  const nova = String(corpo.nova || '');
  if (!(await conferirSenha(String(corpo.atual || ''), acesso.senha))) { await pausa(); return json(403, { erro: 'A senha atual não confere.' }); }
  if (nova.length < SENHA_MINIMA) return json(400, { erro: 'A senha nova precisa ter pelo menos 6 caracteres.' });
  acesso.senha = await hashSenha(nova);
  acesso.sessoes = acesso.sessoes.filter(x => x.hash === sessao.hash);
  await u.gravar('acesso', acesso);
  return json(200, { ok: true });
}

// Só o dono: quem tem conta e o link de convite. "novo_convite: true" troca o link (o antigo para de valer).
async function pessoas(armazem, { id }, corpo, site) {
  let convite = await armazem.ler('convite', null);
  if (!convite?.codigo || corpo.novo_convite === true) {
    convite = { codigo: crypto.randomBytes(12).toString('base64url'), criado_em: new Date().toISOString() };
    await armazem.gravar('convite', convite);
  }
  const lista = await Promise.all((await listarContas(armazem)).map(async c => {
    const a = await armazemDe(armazem, c.id).ler('acesso', {});
    return { nome: c.login, dono: a.dono === true, voce: c.id === id, desde: String(a.criado_em || '').slice(0, 10) };
  }));
  lista.sort((a, b) => b.voce - a.voce || a.nome.localeCompare(b.nome));
  return json(200, { pessoas: lista, convite: `${site}/#convite=${convite.codigo}` });
}

// Para quem esqueceu a senha: o dono gera uma provisória e passa para a pessoa, que troca depois.
// Os aparelhos dessa pessoa saem e pedem a senha nova.
const LETRAS = 'abcdefghjkmnpqrstuvwxyz23456789';
const senhaProvisoria = () => Array.from({ length: 8 }, () => LETRAS[crypto.randomInt(LETRAS.length)]).join('').replace(/^(.{4})/, '$1-');
async function novaSenhaDe(armazem, { id }, corpo) {
  const conta = await contaPorNome(armazem, corpo.nome);
  if (!conta) return json(404, { erro: 'Conta não encontrada.' });
  if (conta.id === id) return json(400, { erro: 'Para a sua senha, use Trocar senha.' });
  const senha = senhaProvisoria();
  conta.acesso.senha = await hashSenha(senha);
  conta.acesso.sessoes = [];
  delete conta.acesso.erros;
  await conta.u.gravar('acesso', conta.acesso);
  return json(200, { senha });
}

/* ---------- gasto do Apple Pay ---------- */

// O Atalhos manda JSON; se vier como formulário ou texto, também entende.
async function lerCorpoSolto(req) {
  const texto = (await req.text()).slice(0, 10000);
  try { const j = JSON.parse(texto); if (j && typeof j === 'object') return j; } catch { /* não é JSON */ }
  const form = Object.fromEntries(new URLSearchParams(texto));
  return Object.keys(form).length > 1 ? form : { valor: texto };
}

const primeiro = (obj, nomes) => {
  for (const n of nomes) for (const k of Object.keys(obj)) if (k.toLowerCase() === n && obj[k] != null && String(obj[k]).trim()) return obj[k];
  return '';
};

async function lerEntradas(u) {
  const nomes = await u.listar(ENTRADA);
  const lidas = await Promise.all(nomes.map(async nome => ({ nome, gasto: await u.ler(nome, null) })));
  return lidas.filter(e => e.gasto);
}

async function receberGastoDoAtalho(req, armazem, chave, site) {
  const indice = await armazem.ler(chaveAtalho(chave), null);
  const u = idValido(indice?.id) ? armazemDe(armazem, indice.id) : null;
  const acesso = u ? await u.ler('acesso', null) : null;
  if (!acesso?.atalho || !mesmaChave(chave, acesso.atalho)) return json(404, { erro: 'Endereço não encontrado.' });
  const corpo = await lerCorpoSolto(req);
  const valor = valorEmCentavos(primeiro(corpo, ['valor', 'amount', 'quantia', 'total']));
  if (!valor) return json(400, { erro: 'Não entendi o valor do gasto.' });
  const agora = new Date();
  const hoje = hojeIso(agora, FUSO);
  const dados = (await u.ler('dados', null)) || dadosIniciais();
  const p = dados.preferencias;
  const cartao = String(primeiro(corpo, ['cartao', 'cartão', 'card', 'cartao ou passe']));
  const gasto = limparGasto({
    id: crypto.randomUUID(),
    valor,
    descricao: String(primeiro(corpo, ['local', 'estabelecimento', 'comerciante', 'merchant', 'descricao', 'nome'])),
    cartao,
    data: hoje,
    origem: 'applepay',
    // cartão marcado como débito em Ajustes: sai do salário na hora
    forma: cartaoNaLista(cartao, p.debito) ? 'avista' : 'credito',
    criado_em: agora.toISOString(),
    atualizado_em: agora.toISOString()
  });
  // Grava só o gasto, num arquivo próprio. O app junta tudo na próxima sincronização.
  await u.gravar(ENTRADA + gasto.id, gasto);

  const pendentes = (await lerEntradas(u)).map(e => e.gasto);
  const todos = [...new Map([...(dados.gastos || []), ...pendentes].map(g => [g.id, g])).values()];
  const r = resumoDoMes(todos, hoje.slice(0, 7), p.renda || 0, hoje);
  if (p.aviso_gasto !== false) {
    const onde = gasto.descricao + (gasto.cartao ? ` · ${gasto.cartao}` : '');
    const texto = p.renda ? (r.sobra >= 0 ? `Sobram ${reais(r.sobra)} este mês.` : `Passou ${reais(-r.sobra)} do que você recebe este mês.`) : `Total do mês: ${reais(r.total)}.`;
    await avisarNoCelular(u, { titulo: `${reais(valor)} · ${onde}`, texto, url: site + '/#financas', tag: 'gasto-' + gasto.id }, site);
  }
  return json(200, { ok: true, valor: reais(valor), sobra: reais(r.sobra) });
}
