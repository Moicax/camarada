// Testa o Camarada publicado, de ponta a ponta (roda no GitHub depois de cada publicação).
// Cria contas de teste (verificacao-...@example.com), simula uma compra do Apple Pay,
// confere a segurança entre contas, usa o app num iPhone simulado e apaga tudo no fim.
//
// Precisa de: SUPABASE_ACCESS_TOKEN. Usa web/config.js para achar o projeto.
// Fotos das telas ficam em verificacao/.
import { mkdir, appendFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../web/config.js';
import { emailDeEntrada, nomeDeEntrada } from '../web/lib/contas.js';
import { hashSenha } from '../antigo/servidor/nucleo.js';
import { resumoAtalhoAntigo } from '../supabase/functions/_shared/senha-antiga.js';

// Testa o endereço de teste (o principal fica com a versão antiga e não é tocado).
const SITE = 'https://teste--camarada-organizador.netlify.app';
const URL_SB = CONFIG.supabaseUrl;
const REF = new URL(URL_SB).hostname.split('.')[0];
const FUSO = 'America/Sao_Paulo';
const PREFIXO = 'verificacao-';
const DOMINIO = '@example.com';
const marca = Date.now().toString(36);
const email = (quem) => `${PREFIXO}${quem}-${marca}${DOMINIO}`;
const SENHA = `Teste-${marca}-${Math.random().toString(36).slice(2)}`;
// Contas que entram pelo nome (como no app antigo).
const NOME_C = `Verificacao C ${marca}`;
const NOME_D = `Verificacao D ${marca}`;
const SENHA_ANTIGA_D = `Antiga-${marca}`;
const SEGREDO_ATALHO_D = `seg-${marca}-${Math.random().toString(36).slice(2)}-xyzxyz`;

const resultados = [];
function conferir(nome, ok, detalhe = '') {
  resultados.push({ nome, ok: Boolean(ok), detalhe });
  console.log(`${ok ? '✓' : '✗'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}
async function etapa(nome, fn) {
  try {
    await fn();
  } catch (e) {
    conferir(nome, false, e.message);
  }
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const corpo = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`SQL ${r.status}: ${JSON.stringify(corpo)}`);
  return corpo;
}

const dia = (deslocamento = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(Date.now() + deslocamento * 86400000));

let chaveServico = null;
async function criarUsuario(emailNovo, senha, nome) {
  if (!chaveServico) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
      headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
    });
    const chaves = await r.json();
    chaveServico = (chaves.find((k) => k.name === 'service_role' && k.api_key) ?? chaves.find((k) => k.type === 'secret' && k.api_key)).api_key;
  }
  const r = await fetch(`${URL_SB}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: chaveServico, authorization: `Bearer ${chaveServico}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: emailNovo, password: senha, email_confirm: true, user_metadata: { nome } }),
  });
  const corpo = await r.json();
  if (!r.ok) throw new Error(`criar ${emailNovo}: ${JSON.stringify(corpo)}`);
  return corpo.id;
}

async function novaConta(quem) {
  const id = await criarUsuario(email(quem), SENHA, `Teste ${quem}`);
  const c = createClient(URL_SB, CONFIG.supabaseAnonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: email(quem), password: SENHA });
  if (error) throw new Error(`entrar ${quem}: ${error.message}`);
  return { cliente: c, id };
}

async function chamarContas(corpo, jwt) {
  const r = await fetch(`${URL_SB}/functions/v1/contas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: CONFIG.supabaseAnonKey, authorization: `Bearer ${jwt ?? CONFIG.supabaseAnonKey}` },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

let contaA = null;

async function registrarCompra(corpo) {
  const r = await fetch(`${URL_SB}/functions/v1/registrar-compra`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

// ---------------------------------------------------------------- 1. site

async function testarSite() {
  const r = await fetch(SITE);
  const html = await r.text();
  conferir('Site abre', r.ok && html.includes('<title>Camarada</title>'), `${SITE} → ${r.status}`);
  const estranhas = html.split('\n').filter((l) => /netlify/i.test(l));
  console.log(`[diagnóstico] linhas com "netlify" no HTML entregue: ${estranhas.length ? estranhas.map((l) => l.trim().slice(0, 300)).join(' || ') : 'nenhuma'}`);
  const cfg = await (await fetch(`${SITE}/config.js`)).text();
  conferir('Site aponta para o servidor novo', cfg.includes(REF));
  for (const arq of ['app.js', 'sw.js', 'manifest.webmanifest', 'icons/apple-touch-icon.png', 'lib/finance.js']) {
    const s = (await fetch(`${SITE}/${arq}`)).status;
    conferir(`Arquivo ${arq}`, s === 200, String(s));
  }
}

// ---------------------------------------------------------------- 2. servidor e segurança

async function testarServidor() {
  const invalido = await registrarCompra({ token: 'f'.repeat(48), valor: '1,00' });
  conferir('Compra com código errado é recusada', invalido.status === 401, `${invalido.status} ${invalido.corpo?.erro ?? ''}`);

  const semSegredo = await fetch(`${URL_SB}/functions/v1/notificar`, { method: 'POST' });
  conferir('Avisos não rodam sem o segredo', semSegredo.status === 401, String(semSegredo.status));

  const anonimo = createClient(URL_SB, CONFIG.supabaseAnonKey, { auth: { persistSession: false } });
  const { data: livre } = await anonimo.auth.signUp({ email: email('intruso'), password: SENHA });
  conferir('Cadastro sem convite é recusado', !livre?.user, livre?.user ? 'criou conta sem convite' : '');

  const a = await novaConta('a');
  contaA = a;
  conferir('Conta criada pelo servidor entra direto', true);

  const { data: perfil, error: ep } = await a.cliente.from('perfis').select('nome, renda_mensal, token_atalho').single();
  conferir('Perfil criado no cadastro', !ep && /^[0-9a-f]{48}$/.test(perfil?.token_atalho ?? ''), ep?.message ?? perfil?.nome);
  const { data: cats } = await a.cliente.from('categorias').select('nome, aviso_dias').order('nome');
  conferir('Categorias iniciais', cats?.map((c) => `${c.nome}:${c.aviso_dias}`).join(',') === 'Contas:5,Documentos:15,Geral:3', JSON.stringify(cats));

  const { error: eRenda } = await a.cliente.from('perfis').update({ renda_mensal: 3000 }).eq('user_id', a.id);
  conferir('Salvar renda', !eRenda, eRenda?.message);
  const { error: eTok } = await a.cliente.from('perfis').update({ token_atalho: 'a'.repeat(48) }).eq('user_id', a.id);
  conferir('App não consegue trocar o código do atalho direto', Boolean(eTok), eTok?.message);

  const contas = cats?.length ? (await a.cliente.from('categorias').select('id').eq('nome', 'Contas').single()).data : null;
  const { error: eTar } = await a.cliente.from('tarefas').insert({ titulo: 'Conta de luz (teste)', vencimento: dia(1), categoria_id: contas?.id });
  conferir('Criar tarefa', !eTar, eTar?.message);

  const compra = await registrarCompra({ token: perfil.token_atalho, valor: 'R$ 12,34', estabelecimento: 'Padaria (teste)', cartao: 'Cartão Teste' });
  conferir('Compra do Atalho registrada', compra.status === 200 && compra.corpo?.ok, `${compra.status} ${compra.corpo?.mensagem ?? compra.corpo?.erro ?? ''}`);

  const { data: gastos } = await a.cliente.from('gastos').select('valor, origem, estabelecimento, cartoes(nome)');
  const g = gastos?.[0];
  conferir('Compra aparece em Finanças', gastos?.length === 1 && Number(g.valor) === 12.34 && g.origem === 'atalho' && g.cartoes?.nome === 'Cartão Teste', JSON.stringify(gastos));

  const b = await novaConta('b');
  const [{ data: tb }, { data: gb }, { data: pb }] = await Promise.all([
    b.cliente.from('tarefas').select('id'), b.cliente.from('gastos').select('id'), b.cliente.from('perfis').select('user_id'),
  ]);
  conferir('Outra pessoa não vê os dados', tb?.length === 0 && gb?.length === 0 && pb?.length === 1, `tarefas ${tb?.length}, gastos ${gb?.length}, perfis ${pb?.length}`);
  const { error: eInv } = await b.cliente.from('gastos').insert({ user_id: a.id, valor: 1 });
  conferir('Outra pessoa não cria dados em nome de alguém', Boolean(eInv), eInv?.message);
  await b.cliente.from('tarefas').update({ titulo: 'invadido' }).neq('titulo', '');
  const { data: ta } = await a.cliente.from('tarefas').select('id, titulo');
  conferir('Outra pessoa não altera os dados', ta?.[0]?.titulo === 'Conta de luz (teste)', ta?.[0]?.titulo);
  const { error: eGer } = await b.cliente.from('tarefas').insert({ titulo: 'x', vencimento: dia(5), gerado_de: ta?.[0]?.id });
  conferir('Outra pessoa não liga tarefa à repetição de alguém', Boolean(eGer), eGer?.message);

  // Meta de gastos de R$ 20: a próxima compra passa de 80% e deve avisar.
  await a.cliente.from('perfis').update({ meta_gasto: 20 }).eq('user_id', a.id);

  // Cartão marcado como débito: a compra do Atalho entra como à vista.
  const { data: cartao } = await a.cliente.from('cartoes').select('id').eq('nome', 'Cartão Teste').single();
  await a.cliente.from('cartoes').update({ debito: true }).eq('id', cartao.id);
  // Nomes de campo como alguém digita no Atalhos (com espaço sobrando e maiúscula): tem que funcionar igual.
  const debito = await registrarCompra({ token: perfil.token_atalho, 'valor ': '5,00', 'Comerciante ': 'Café (débito)', cartao: 'Cartão Teste' });
  conferir('Compra com cartão de débito entra como à vista', debito.corpo?.forma === 'avista', `${debito.status} ${debito.corpo?.mensagem ?? debito.corpo?.erro ?? ''}`);
  conferir('Meta de gastos: aviso dos 80% sai na compra', debito.corpo?.meta?.nivel === 80 && debito.corpo?.meta?.enviado === true, JSON.stringify(debito.corpo?.meta));
  const passou = await registrarCompra({ token: perfil.token_atalho, valor: '5,00', estabelecimento: 'Mais um café', cartao: 'Cartão Teste' });
  conferir('Meta de gastos: aviso dos 100% sai ao passar', passou.corpo?.meta?.nivel === 100 && passou.corpo?.meta?.enviado === true, JSON.stringify(passou.corpo?.meta));
  const { data: deNovo, error: eMeta } = await a.cliente.functions.invoke('notificar', { body: { tipo: 'meta' } });
  conferir('Meta de gastos: o mesmo aviso não se repete', !eMeta && deNovo?.nivel === 100 && deNovo?.enviado === false, eMeta?.message ?? JSON.stringify(deNovo));
  const avisos = async () => (await sql(`select count(*)::int as n from public.avisos_meta m join auth.users u on u.id = m.user_id where u.email = '${email('a')}'`))[0].n;
  const antes = await avisos();
  await a.cliente.from('perfis').update({ meta_gasto: 1000 }).eq('user_id', a.id);
  const depois = await avisos();
  conferir('Meta de gastos: mudar a meta zera os avisos do mês', antes === 2 && depois === 0, `${antes} → ${depois}`);
  const { error: eLer } = await a.cliente.from('avisos_meta').select('*');
  conferir('App não lê os avisos da meta direto', Boolean(eLer), eLer?.message);

  // Tarefa que repete.
  const { error: eRep } = await a.cliente.from('tarefas').insert({ titulo: 'Aluguel (teste)', vencimento: dia(10), recorrencia: 'mensal', dia_original: Number(dia(10).slice(8)) });
  conferir('Tarefa que repete', !eRep, eRep?.message);

  // Botão "Testar notificação": com login responde; sem login é recusado.
  const { data: tn, error: etn } = await a.cliente.functions.invoke('notificar', { body: { tipo: 'teste' } });
  conferir('Testar notificação responde', !etn && tn?.ok === true, etn?.message ?? JSON.stringify(tn));
  // Dinheiro com dono: a conta de luz (vence amanhã) ganha valor; o bom dia avisa que já está separada.
  await a.cliente.from('tarefas').update({ valor: 180 }).eq('titulo', 'Conta de luz (teste)');
  const { data: bd, error: ebd } = await a.cliente.functions.invoke('notificar', { body: { tipo: 'bomdia' } });
  conferir('Bom dia avisa a conta que vence amanhã, já separada', /vence amanhã: R\$\s?180,00 já estão separados/.test(bd?.corpo ?? ''), bd?.corpo);
  conferir('Ver o bom dia: monta a mensagem', !ebd && /^(Bom dia|Boa tarde|Boa noite)/.test(bd?.titulo ?? '') && /pontos/.test(bd?.corpo ?? ''), ebd?.message ?? `${bd?.titulo} ${bd?.corpo}`);
  conferir('Conta nova começa do zero (sem sequência inventada)', /0\/100 pontos/.test(bd?.corpo ?? '') && !/dias seguidos/.test(bd?.corpo ?? ''), bd?.corpo);
  // O bom dia usa o mesmo número do dia do app: mesada por semana tem limite; renda que varia, sem nada entrar, não.
  await a.cliente.from('perfis').update({ tipo_renda: 'semanal', renda_semanal: 100 }).eq('user_id', a.id);
  const { data: bdSemana } = await a.cliente.functions.invoke('notificar', { body: { tipo: 'bomdia' } });
  await a.cliente.from('perfis').update({ tipo_renda: 'variavel' }).eq('user_id', a.id);
  const { data: bdVaria } = await a.cliente.functions.invoke('notificar', { body: { tipo: 'bomdia' } });
  await a.cliente.from('perfis').update({ tipo_renda: 'mensal' }).eq('user_id', a.id);
  conferir('Bom dia com mesada por semana mostra quanto dá para gastar', /para gastar/.test(bdSemana?.corpo ?? ''), bdSemana?.corpo);
  conferir('Bom dia com renda que varia (nada entrou) não inventa limite', !/para gastar/.test(bdVaria?.corpo ?? ''), bdVaria?.corpo);
  const semLogin = await fetch(`${URL_SB}/functions/v1/notificar`, { method: 'POST', body: JSON.stringify({ tipo: 'teste' }) });
  conferir('Testar notificação exige login', semLogin.status === 401, String(semLogin.status));

  await testarContas(a, b);
}

// ---------------------------------------------------------------- 2b. contas (como no app antigo)

async function testarContas(a, b) {
  const jwt = async (conta) => (await conta.cliente.auth.getSession()).data.session.access_token;
  const negado = await chamarContas({ acao: 'pessoas' }, await jwt(a));
  conferir('Só o dono vê as pessoas', negado.status === 403, `${negado.status}`);
  await sql(`update public.perfis set dono = true where user_id = '${a.id}'`);
  const pessoas = await chamarContas({ acao: 'pessoas' }, await jwt(a));
  conferir('Dono vê a lista de pessoas', pessoas.corpo?.pessoas?.some((x) => x.user_id === b.id), `${pessoas.status}`);
  const nova = await chamarContas({ acao: 'nova-senha', user_id: b.id }, await jwt(a));
  const comNova = createClient(URL_SB, CONFIG.supabaseAnonKey, { auth: { persistSession: false } });
  const { error: eNova } = await comNova.auth.signInWithPassword({ email: email('b'), password: nova.corpo?.senha ?? '-' });
  conferir('Dono gera senha provisória e ela funciona', /^[a-z2-9]{4}-[a-z2-9]{4}$/.test(nova.corpo?.senha ?? '') && !eNova, eNova?.message ?? `${nova.status}`);
  const conviteErrado = await chamarContas({ acao: 'criar', convite: '0'.repeat(36), nome: 'Intruso', senha: 'qualquer123' });
  conferir('Criar conta com convite errado é recusado', conviteErrado.status === 403, `${conviteErrado.status}`);

  // Conta que veio do app antigo: entra com a senha antiga; o Atalho antigo do Apple Pay continua valendo.
  const loginD = nomeDeEntrada(NOME_D);
  const idD = await criarUsuario(emailDeEntrada(loginD), `aleatoria-${Math.random()}`, NOME_D);
  await sql(`update public.perfis set login = '${loginD}' where user_id = '${idD}';
    insert into public.contas_antigas (user_id, id_antigo, login, senha_hash, atalho_hash)
    values ('${idD}', '${marca.padEnd(16, '0').slice(0, 16).replace(/[^a-f0-9]/g, 'a')}', '${loginD}', '${await hashSenha(SENHA_ANTIGA_D)}', '${resumoAtalhoAntigo(SEGREDO_ATALHO_D)}')`);
  const errada = await chamarContas({ acao: 'senha-antiga', nome: NOME_D, senha: 'senha-errada' });
  conferir('Senha antiga errada é recusada', errada.status === 401, `${errada.status}`);
  // Como no app antigo: no 20º erro seguido, bloqueia por 15 minutos (até a senha certa).
  await sql(`update public.contas_antigas set tentativas = 19 where user_id = '${idD}'`);
  await chamarContas({ acao: 'senha-antiga', nome: NOME_D, senha: 'senha-errada' });
  const bloqueada = await chamarContas({ acao: 'senha-antiga', nome: NOME_D, senha: SENHA_ANTIGA_D });
  conferir('20 senhas antigas erradas bloqueiam por 15 minutos', bloqueada.status === 429, `${bloqueada.status}`);
  await sql(`update public.contas_antigas set tentativas = 0, bloqueado_ate = null where user_id = '${idD}'`);

  // Aparelho que troca de conta: a inscrição de notificações passa para quem entrou.
  const endpoint = `https://example.com/push/verificacao-${marca}`;
  const { error: eA } = await a.cliente.rpc('registrar_inscricao_push', { p_endpoint: endpoint, p_p256dh: 'x', p_auth: 'y' });
  const { error: eB } = await b.cliente.rpc('registrar_inscricao_push', { p_endpoint: endpoint, p_p256dh: 'x', p_auth: 'y' });
  const [dono] = await sql(`select user_id from public.inscricoes_push where endpoint = '${endpoint}'`);
  conferir('Notificações: aparelho que troca de conta passa a avisar só a conta nova', !eA && !eB && dono?.user_id === b.id, eA?.message ?? eB?.message ?? '');
  await sql(`delete from public.inscricoes_push where endpoint = '${endpoint}'`);

  const antiga = await fetch(`${SITE}/api/gasto/${SEGREDO_ATALHO_D}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ valor: 'R$ 9,99', local: 'Padaria (atalho antigo)', cartao: 'Cartão Antigo' }),
  });
  const corpoAntigo = await antiga.json().catch(() => null);
  const [{ n: noD }] = await sql(`select count(*)::int as n from public.gastos where user_id = '${idD}' and valor = 9.99 and estabelecimento = 'Padaria (atalho antigo)'`);
  conferir('Atalho antigo do Apple Pay (endereço do site) continua funcionando', antiga.status === 200 && noD === 1, `${antiga.status} ${JSON.stringify(corpoAntigo)}`);
  const falso = await fetch(`${SITE}/api/gasto/endereco-que-nao-existe-123456`, { method: 'POST', body: '{"valor":"1"}' });
  conferir('Endereço antigo inventado é recusado', falso.status === 404, String(falso.status));
}

// ---------------------------------------------------------------- 3. avisos diários

/** Roda exatamente o comando de um agendamento e devolve a resposta da função (ou null se não chamou). */
async function rodarAgendamento(nome) {
  const [{ command }] = await sql(`select command from cron.job where jobname = '${nome}'`);
  const linhas = await sql(`select x.id from (${command.trim().replace(/;\s*$/, '')}) as x(id)`);
  if (!linhas.length) return null;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const [resp] = await sql(`select status_code, content::text as content from net._http_response where id = ${Number(linhas[0].id)}`);
    if (resp) return resp;
  }
  return { status_code: 0, content: 'sem resposta em 30s' };
}

const agoraEm = (minutos = 0) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + minutos * 60000)).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, h: Number(p.hour) };
};

async function testarAvisos() {
  const jobs = await sql("select jobname, schedule, active from cron.job where jobname in ('camarada-avisos', 'camarada-lembretes')");
  const job = (n) => jobs.find((j) => j.jobname === n);
  conferir('Avisos do dia agendados de hora em hora', job('camarada-avisos')?.schedule === '0 * * * *' && job('camarada-avisos')?.active, JSON.stringify(job('camarada-avisos')));
  conferir('Lembretes por horário agendados a cada minuto', job('camarada-lembretes')?.schedule === '* * * * *' && job('camarada-lembretes')?.active, JSON.stringify(job('camarada-lembretes')));

  // Avisos do dia: a conta A escolhe a hora atual; roda o que o agendamento roda.
  await contaA.cliente.from('perfis').update({ horario_aviso: agoraEm().h }).eq('user_id', contaA.id);
  const diario = await rodarAgendamento('camarada-avisos');
  conferir('Avisos do dia respondem ao agendamento', diario?.status_code === 200, diario ? `${diario.status_code} ${diario.content}` : 'não chamou');
  const bomdias = async () => (await sql(`select count(*)::int as n from public.avisos_enviados e join auth.users u on u.id = e.user_id where u.email = '${email('a')}' and e.chave like 'bomdia-%'`))[0].n;
  conferir('Bom dia sai no horário escolhido', (await bomdias()) === 1 && /"bomdia"/.test(diario?.content ?? ''), diario?.content);
  await rodarAgendamento('camarada-avisos');
  conferir('Bom dia sai uma vez só por dia', (await bomdias()) === 1);
  const { data: luz } = await contaA.cliente.from('tarefas').select('avisos_enviados').eq('titulo', 'Conta de luz (teste)').single();
  conferir('Tarefa que vence amanhã recebeu o aviso de véspera', (luz?.avisos_enviados ?? []).includes('vespera'), JSON.stringify(luz));

  // Lembretes: tarefa daqui a 30 minutos deve receber o de 1 hora.
  const em30 = agoraEm(30);
  await contaA.cliente.from('tarefas').insert({ titulo: 'Dentista (teste)', vencimento: em30.dia, hora: em30.hora });
  const lembrete = await rodarAgendamento('camarada-lembretes');
  conferir('Lembretes respondem ao agendamento', lembrete?.status_code === 200, lembrete ? `${lembrete.status_code} ${lembrete.content}` : 'não chamou');
  const { data: dent } = await contaA.cliente.from('tarefas').select('avisos_enviados').eq('titulo', 'Dentista (teste)').single();
  conferir('Tarefa daqui a 30 min recebeu o lembrete de 1 hora', (dent?.avisos_enviados ?? []).includes('h1'), JSON.stringify(dent));
}

// ---------------------------------------------------------------- 4. app no iPhone (simulado)

async function testarApp() {
  const { chromium, devices } = await import('playwright');
  await mkdir('verificacao', { recursive: true });
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ ...devices['iPhone 12'], locale: 'pt-BR', timezoneId: FUSO });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  const foto = (nome) => p.screenshot({ path: `verificacao/${nome}.png` });
  try {
    await p.goto(SITE, { waitUntil: 'networkidle' });
    await p.waitForSelector('#form-entrada', { timeout: 20000 });
    await p.waitForTimeout(1500);
    const estranhos = await p.evaluate(() => {
      const nossos = new Set(['app']);
      const lista = [...document.body.children]
        .filter((el) => !nossos.has(el.id) && !['SCRIPT', 'NOSCRIPT'].includes(el.tagName))
        .map((el) => `${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].join('.')} shadow=${Boolean(el.shadowRoot)} ${el.outerHTML.slice(0, 400)}`);
      const scripts = [...document.scripts].map((x) => x.src || `(inline ${x.textContent.slice(0, 120)})`);
      const iframes = [...document.querySelectorAll('iframe')].map((f) => {
        const r = f.getBoundingClientRect();
        return `${f.id} x=${Math.round(r.x)} y=${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} (tela ${innerWidth}x${innerHeight})`;
      });
      return { lista, scripts, iframes };
    });
    console.log(`[diagnóstico] elementos fora do app: ${JSON.stringify(estranhos)}`);
    await foto('1-entrada');
    conferir('App: entrada pede nome (não e-mail)', await p.locator('input[name=nome]').count() === 1 && await p.locator('input[name=email]').count() === 0);
    await sql("insert into public.convite (id, codigo) values (1, encode(gen_random_bytes(18), 'hex')) on conflict (id) do nothing");
    const [{ codigo }] = await sql('select codigo from public.convite where id = 1');
    await p.goto(`${SITE}/#convite=${codigo}`, { waitUntil: 'networkidle' });
    await p.waitForSelector('text=Você foi convidado', { timeout: 20000 });
    await p.fill('input[name=nome]', NOME_C);
    await p.fill('input[name=senha]', SENHA);
    await p.click('button[type=submit]');
    await p.waitForSelector('.camarada-cartao', { timeout: 20000 });
    conferir('App: criar conta pelo link de convite', true);
    conferir('App: abre na aba Hoje, com saudação', /^(Bom dia|Boa tarde|Boa noite)/.test(await p.locator('.topo h1').innerText()));
    await p.click('[data-tela=tarefas]');
    await p.waitForSelector('.segmentos', { timeout: 15000 });

    await p.click('[data-acao=nova-tarefa]');
    await p.fill('#folha input[name=titulo]', 'Pagar conta de luz');
    await p.fill('#t-venc', dia(1));
    await p.fill('#t-hora', '18:00');
    await p.selectOption('#t-cat', { label: 'Contas' });
    await p.click('#folha button[type=submit]');
    await p.waitForSelector('.linha', { timeout: 15000 });
    await p.waitForTimeout(500);
    conferir('App: tarefa criada vai para A expirar', (await p.locator('[aria-selected=true]').innerText()).includes('A expirar'));
    conferir('App: horário aparece no prazo', (await p.locator('.lista').innerText()).includes('Vence amanhã às 18h'));
    await p.locator('.linha .marcar').first().click();
    await p.click('.dialogo [data-r="1"]');
    await p.waitForTimeout(1200);
    await p.click('[data-tela=hoje]');
    await p.waitForSelector('.camarada-cartao', { timeout: 15000 });
    await p.waitForTimeout(800);
    const pontos = Number(await p.locator('.cc-num').innerText());
    conferir('App: concluir tarefa no prazo dá 10 pontos', pontos === 10, `${pontos} pontos`);
    await foto('2b-hoje');
    await p.click('[data-tela=tarefas]');
    await p.waitForSelector('.segmentos', { timeout: 15000 });
    await foto('2-tarefas');

    await p.click('[data-tela=financas]');
    await p.waitForSelector('.destaque', { timeout: 15000 });
    await p.click('[data-acao=renda] >> nth=0');
    await p.fill('#r-valor', '3.000,00');
    await p.click('button[data-tipo=padrao]');
    await p.waitForSelector('text=Hoje ainda dá para gastar', { timeout: 15000 });
    await p.click('[data-acao=novo-gasto]');
    await p.fill('#g-valor', '25,90');
    await p.fill('#g-onde', 'Mercado');
    await p.fill('#g-cartao', 'Nubank');
    await p.click('#folha button[type=submit]');
    await p.waitForSelector('.gasto', { timeout: 15000 });
    conferir('App: renda e gasto lançados', true);
    conferir('App: mostra crédito e à vista', /no crédito/i.test(await p.locator('.dois').innerText()));

    // Saldo sincero: lançar, apagar, desfazer e entrada, lendo o "Resta" na tela a cada passo.
    const resta = async () => {
      await p.waitForTimeout(1200);
      return Math.round(Number((await p.locator('.tres .mini >> nth=2 >> .num').innerText()).replace(/[^\d,-]/g, '').replace(',', '.')) * 100);
    };
    const r0 = await resta();
    await p.click('[data-acao=novo-gasto]');
    await p.fill('#g-valor', '50,00');
    await p.fill('#g-onde', 'Engano');
    await p.click('#folha button[type=submit]');
    const r1 = await resta();
    await p.click('.gasto:has-text("Engano")');
    await p.click('#folha [data-apagar]');
    await p.click('.dialogo [data-r="1"]');
    const r2 = await resta();
    await p.click('.aviso-flutuante button');
    const r3 = await resta();
    await p.click('.gasto:has-text("Engano")');
    await p.click('#folha [data-apagar]');
    await p.click('.dialogo [data-r="1"]');
    const r4 = await resta();
    conferir('App: lançar R$ 50 tira R$ 50 do saldo', r0 - r1 === 5000, `${r0} → ${r1}`);
    conferir('App: apagar devolve exatamente', r2 === r0, `${r1} → ${r2}`);
    conferir('App: desfazer e apagar de novo fecham a conta', r0 - r3 === 5000 && r4 === r0, `${r3}, ${r4}`);
    await p.click('[data-acao=novo-gasto]');
    await p.click('.tres-segmentos label:has-text("Entrada")');
    await p.fill('#g-valor', '200,00');
    await p.fill('#g-onde', 'Freela');
    await p.click('#folha button[type=submit]');
    const r5 = await resta();
    conferir('App: entrada de R$ 200 soma no saldo', r5 - r0 === 20000, `${r0} → ${r5}`);
    await p.click('[data-acao=investir]');
    await p.fill('#g-valor', '100,00');
    await p.fill('#g-onde', 'Tesouro');
    await p.click('#folha button[type=submit]');
    const r6 = await resta();
    conferir('App: investir R$ 100 tira R$ 100 do que dá para gastar', r5 - r6 === 10000, `${r5} → ${r6}`);
    conferir('App: investimento aparece nas metas do mês', (await p.locator('.metas:not(.objetivos)').innerText()).includes('R$ 100,00'));

    // Dinheiro com dono: conta de R$ 180 que vence amanhã sai do mês antes de vencer; "Paguei" lança o
    // gasto sem contar duas vezes e sem comer o limite de hoje; "Desfazer" volta tudo.
    const centavosDe = (txt) => Math.round(Number(txt.replace(/[^\d,-]/g, '').replace(',', '.')) * 100);
    const limiteHoje = async () => {
      await p.waitForTimeout(1200);
      const legenda = await p.locator('.destaque .legenda').innerText();
      const v = centavosDe(await p.locator('.destaque .grande').innerText());
      return /passou/i.test(legenda) ? -v : v;
    };
    const irFinancas = async () => { await p.click('[data-tela=financas]'); await p.waitForSelector('.destaque', { timeout: 15000 }); };
    const concluirConta = async (escolha) => {
      await p.click('[data-tela=tarefas]');
      await p.waitForSelector('.segmentos', { timeout: 15000 });
      await p.click('[data-aba=vencendo]');
      await p.locator('.linha:has-text("Conta de luz (teste)") .marcar').click();
      await p.waitForSelector('.dialogo-botoes.vertical', { timeout: 10000 });
      await p.click(`.dialogo-botoes.vertical [data-i="${escolha}"]`);
      await p.waitForSelector('.aviso-flutuante', { timeout: 15000 });
    };
    await irFinancas();
    const semConta = await resta();
    await p.click('[data-tela=tarefas]');
    await p.click('[data-acao=nova-tarefa]');
    await p.fill('#folha input[name=titulo]', 'Conta de luz (teste)');
    await p.fill('#t-venc', dia(1));
    await p.fill('#t-valor', '180,00');
    await p.click('#folha button[type=submit]');
    await p.waitForSelector('.linha:has-text("Conta de luz (teste)")', { timeout: 15000 });
    conferir('App: conta com valor mostra o valor na lista', (await p.locator('.linha:has-text("Conta de luz (teste)")').innerText()).includes('R$ 180,00'));
    await irFinancas();
    const comConta = await resta();
    const hojeComConta = await limiteHoje();
    const dono = await p.locator('.contas-dono').innerText().catch(() => '');
    conferir('App: "Já têm dono" mostra a conta e ela sai do mês antes de vencer', dono.includes('Conta de luz (teste)') && semConta - comConta === 18000, `${semConta} → ${comConta}`);
    await foto('3b-dinheiro-com-dono');
    await concluirConta(0); // Paguei
    await p.click('.aviso-flutuante button'); // Desfazer
    await p.waitForTimeout(1500);
    await irFinancas();
    const desfeito = await resta();
    const gastoDesfeito = await p.locator('.gasto:has-text("Conta de luz (teste)")').count();
    conferir('App: desfazer o "Paguei" volta a conta e apaga o gasto', desfeito === comConta && gastoDesfeito === 0 && (await p.locator('.contas-dono').innerText()).includes('Conta de luz (teste)'), `${comConta} → ${desfeito}, gastos ${gastoDesfeito}`);
    await concluirConta(0); // Paguei de novo
    await irFinancas();
    await p.waitForSelector('.gasto:has-text("Conta de luz (teste)")', { timeout: 15000 });
    const pago = await resta();
    const hojePago = await limiteHoje();
    const linhaPaga = await p.locator('.gasto:has-text("Conta de luz (teste)")').innerText();
    conferir('App: "Paguei" lança o gasto à vista, marcado como conta paga', /Conta paga/.test(linhaPaga) && /À vista/.test(linhaPaga), linhaPaga.replace(/\s+/g, ' '));
    conferir('App: pagar a conta não conta duas vezes (resta igual)', pago === comConta, `${comConta} → ${pago}`);
    conferir('App: pagar a conta não come o limite de hoje', hojePago === hojeComConta, `${hojeComConta} → ${hojePago}`);

    // Objetivo ("Juntar para…"): separa a cota do mês sozinho; "Guardar" não conta duas vezes.
    const semObjetivo = await resta();
    await p.click('[data-acao=novo-objetivo]');
    await p.fill('#folha input[name=titulo]', 'Show (teste)');
    await p.fill('#o-valor', '600,00');
    await p.fill('#o-data', dia(70));
    await p.click('#folha button[type=submit]');
    await p.waitForSelector('.objetivos .meta-linha:has-text("Show (teste)")', { timeout: 15000 });
    const comObjetivo = await resta();
    const hojeComObjetivo = await limiteHoje();
    const linhaReserva = await p.locator('.contas-dono li:has-text("Guardar para Show (teste)")').innerText().catch(() => '');
    const cota = centavosDe(linhaReserva.split('\n').pop() ?? '');
    conferir('App: objetivo separa a cota do mês do que dá para gastar', cota > 0 && semObjetivo - comObjetivo === cota, `cota ${cota}, ${semObjetivo} → ${comObjetivo}`);
    await foto('3c-objetivos');
    await p.click('.objetivos .meta-linha:has-text("Show (teste)") [data-acao=guardar]');
    await p.waitForSelector('#gu-valor', { timeout: 10000 });
    await p.click('#folha button[type=submit]');
    await p.waitForSelector('.aviso-flutuante', { timeout: 15000 });
    await p.waitForTimeout(1500);
    const guardado = await resta();
    const hojeGuardado = await limiteHoje();
    const notaObjetivo = await p.locator('.objetivos .meta-linha:has-text("Show (teste)")').innerText();
    conferir('App: "Guardar" a cota não conta duas vezes nem come o limite de hoje', guardado === comObjetivo && hojeGuardado === hojeComObjetivo && /feito/.test(notaObjetivo), `${comObjetivo} → ${guardado}; hoje ${hojeComObjetivo} → ${hojeGuardado}`);

    // Como recebe: mesada por semana (limite até domingo) e renda que varia (só o que entrou); depois volta ao salário.
    const comoRecebe = async (opcao, valor) => {
      await p.click('[data-tela=ajustes]');
      await p.click('[data-acao=como-recebe]');
      await p.waitForSelector('#cr-valor', { state: 'attached', timeout: 10000 });
      await p.click(`#folha .tres-segmentos label:has-text("${opcao}")`);
      if (valor) await p.fill('#cr-valor', valor);
      await p.click('#folha button[type=submit]');
      await p.waitForSelector('.aviso-flutuante', { timeout: 15000 });
      await irFinancas();
      await p.waitForTimeout(1200);
    };
    await comoRecebe('Mesada', '70,00');
    const semanal = (await p.locator('.destaque').innerText()).replace(/\s+/g, ' ');
    const miniMesada = await p.locator('.tres .mini').first().innerText();
    conferir('App: mesada por semana calcula o limite até domingo', /semana|domingo/i.test(semanal) && /Mesada/i.test(miniMesada), semanal.slice(0, 140));
    await comoRecebe('Varia');
    const miniVaria = (await p.locator('.tres .mini').first().innerText()).replace(/\s+/g, ' ');
    conferir('App: renda que varia usa só o que entrou', /Entrou/i.test(miniVaria) && /200,00/.test(miniVaria), miniVaria);
    await comoRecebe('Salário', '3.000,00');

    // Compra pelo Atalho, com o código desta conta, e o app recarrega ao voltar.
    const c = createClient(URL_SB, CONFIG.supabaseAnonKey, { auth: { persistSession: false } });
    await c.auth.signInWithPassword({ email: emailDeEntrada(NOME_C), password: SENHA });
    const { data: perfil } = await c.from('perfis').select('token_atalho').single();
    const compra = await registrarCompra({ token: perfil.token_atalho, valor: 'R$ 8,50', estabelecimento: 'Café', cartao: 'Nubank' });
    const t0 = Date.now();
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForSelector('.gasto', { timeout: 20000 });
    conferir('App: reabrir já logado carrega direto', true, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await p.waitForSelector('.gasto-icone.auto', { timeout: 15000 });
    conferir('App: compra do Atalho aparece com o raio', compra.status === 200);
    await p.waitForTimeout(1500);
    // Logo depois de reabrir: nenhuma aba pode ficar debaixo do selo do Netlify.
    const cobertas = await p.evaluate(() => [...document.querySelectorAll('.barra-base button')]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !b.contains(el);
      })
      .map((b) => b.textContent.trim()));
    conferir('App: selo do Netlify não cobre as abas', cobertas.length === 0, cobertas.length ? `cobertas: ${cobertas.join(', ')}` : '');
    await foto('3-financas');

    await p.click('[data-tela=ajustes]');
    await p.click('[data-acao=automaticas]');
    await p.waitForTimeout(600);
    // Status da conexão: esta conta já teve uma compra pelo Atalho, então tem que aparecer "Conectado".
    await p.waitForSelector('.status-atalho.ok', { timeout: 15000 }).catch(() => {});
    const status = await p.locator('.status-atalho').innerText().catch(() => '');
    conferir('App: Compras automáticas mostra "Conectado" depois da compra pelo Atalho', /Conectado/.test(status), status.replace(/\s+/g, ' ').slice(0, 120));
    const textoPronto = await p.locator('.texto-automacao').textContent();
    conferir('App: texto pronto da automação já vem com o código da conta', textoPronto.includes(perfil.token_atalho) && textoPronto.includes('/functions/v1/registrar-compra'));
    await foto('4-compras-automaticas');
    await p.click('#folha [data-fechar]');

    // Cartão de débito pela tela (antes a lista vinha sem nome e o botão não funcionava).
    const linhaNubank = p.locator('label.item:has-text("Nubank")');
    await linhaNubank.waitFor({ timeout: 10000 });
    await linhaNubank.click();
    await p.waitForSelector('.aviso-flutuante:has-text("Nubank: compras saem do salário na hora")', { timeout: 10000 });
    const [{ debito: nubankDebito }] = await sql(`select k.debito from public.cartoes k join public.perfis p on p.user_id = k.user_id
      where p.login = '${nomeDeEntrada(NOME_C)}' and k.nome = 'Nubank'`);
    conferir('App: marcar cartão de débito em Ajustes', nubankDebito === true);

    // Sair e entrar com o nome e a senha do app antigo (primeira entrada depois da mudança).
    await p.click('[data-acao=sair]');
    await p.click('.dialogo [data-r="1"]');
    await p.waitForSelector('#form-entrada', { timeout: 15000 });
    await p.fill('input[name=nome]', `  ${NOME_D.toUpperCase()} `);
    await p.fill('input[name=senha]', SENHA_ANTIGA_D);
    const errosAntes = erros.length;
    await p.click('button[type=submit]');
    await p.waitForSelector('.barra-base, .erro', { timeout: 20000 });
    const msgErro = await p.locator('.erro').first().textContent({ timeout: 500 }).catch(() => '');
    if (msgErro) throw new Error(`entrada com senha antiga: ${msgErro}`);
    // A 1ª tentativa no login novo dá 400 (a senha ainda é a do app antigo): esperado.
    erros.splice(errosAntes, erros.length - errosAntes, ...erros.slice(errosAntes).filter((m) => !/status of 400/.test(m)));
    const [{ h: restou }] = await sql(`select count(senha_hash)::int as h from public.contas_antigas where login = '${nomeDeEntrada(NOME_D)}'`);
    conferir('App: entra com o nome e a senha do app antigo', restou === 0, `senha antiga ainda guardada: ${restou}`);
    await p.click('[data-tela=ajustes]');
    await p.waitForSelector('[data-acao=trocar-senha]', { timeout: 10000 });
    await foto('5-ajustes-conta');
    conferir('App: sem erros na tela', erros.length === 0, erros.join(' | '));
  } catch (e) {
    await foto('erro').catch(() => {});
    conferir('App no iPhone simulado', false, `${e.message.split('\n')[0]} | erros da página: ${erros.join(' | ')}`);
  } finally {
    await navegador.close();
  }
}

// ---------------------------------------------------------------- principal

async function limpar() {
  const r = await sql(`delete from auth.users where email like '${PREFIXO}%${DOMINIO}' or email like '${PREFIXO}%@contas.camarada-organizador.netlify.app' returning email`);
  console.log(`Limpeza: ${r.length} contas de teste apagadas (com tudo o que era delas).`);
}

if (!process.env.SUPABASE_ACCESS_TOKEN || !URL_SB) {
  console.log('Sem SUPABASE_ACCESS_TOKEN ou sem servidor configurado; nada a verificar.');
  process.exit(0);
}

try {
  await etapa('Site', testarSite);
  await etapa('Servidor', testarServidor);
  await etapa('Avisos', testarAvisos);
  await etapa('App', testarApp);
} finally {
  await etapa('Limpeza', limpar);
}

const falhas = resultados.filter((r) => !r.ok);
const linhas = [
  `## ${falhas.length ? '✗' : '✅'} Verificação do Camarada no ar (${resultados.length - falhas.length}/${resultados.length})`,
  '',
  ...resultados.map((r) => `- ${r.ok ? '✓' : '✗'} ${r.nome}${!r.ok && r.detalhe ? ` — ${r.detalhe}` : ''}`),
];
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${linhas.join('\n')}\n`);
await mkdir('verificacao', { recursive: true });
await appendFile('verificacao/RESULTADO.md', `${linhas.join('\n')}\n`);
process.exit(falhas.length ? 1 : 0);
