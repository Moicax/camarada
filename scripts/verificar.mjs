// Testa o Camarada publicado, de ponta a ponta (roda no GitHub depois de cada publicação).
// Cria contas de teste (verificacao-...@example.com), simula uma compra do Apple Pay,
// confere a segurança entre contas, usa o app num iPhone simulado e apaga tudo no fim.
//
// Precisa de: SUPABASE_ACCESS_TOKEN. Usa web/config.js para achar o projeto.
// Fotos das telas ficam em verificacao/.
import { mkdir, appendFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../web/config.js';

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

async function novaConta(quem) {
  const c = createClient(URL_SB, CONFIG.supabaseAnonKey, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: email(quem), password: SENHA, options: { data: { nome: `Teste ${quem}` } } });
  if (error) throw new Error(`cadastro ${quem}: ${error.message}`);
  if (!data.session) throw new Error(`cadastro ${quem}: conta criada sem sessão (confirmação por e-mail ainda ligada)`);
  return { cliente: c, id: data.user.id };
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

  const a = await novaConta('a');
  contaA = a;
  conferir('Cadastro entra direto (sem confirmar e-mail)', true);

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

  // Cartão marcado como débito: a compra do Atalho entra como à vista.
  const { data: cartao } = await a.cliente.from('cartoes').select('id').eq('nome', 'Cartão Teste').single();
  await a.cliente.from('cartoes').update({ debito: true }).eq('id', cartao.id);
  const debito = await registrarCompra({ token: perfil.token_atalho, valor: '5,00', estabelecimento: 'Café (débito)', cartao: 'Cartão Teste' });
  conferir('Compra com cartão de débito entra como à vista', debito.corpo?.forma === 'avista', `${debito.status} ${debito.corpo?.mensagem ?? debito.corpo?.erro ?? ''}`);

  // Tarefa que repete.
  const { error: eRep } = await a.cliente.from('tarefas').insert({ titulo: 'Aluguel (teste)', vencimento: dia(10), recorrencia: 'mensal', dia_original: Number(dia(10).slice(8)) });
  conferir('Tarefa que repete', !eRep, eRep?.message);

  // Botão "Testar notificação": com login responde; sem login é recusado.
  const { data: tn, error: etn } = await a.cliente.functions.invoke('notificar', { body: { tipo: 'teste' } });
  conferir('Testar notificação responde', !etn && tn?.ok === true, etn?.message ?? JSON.stringify(tn));
  const semLogin = await fetch(`${URL_SB}/functions/v1/notificar`, { method: 'POST', body: JSON.stringify({ tipo: 'teste' }) });
  conferir('Testar notificação exige login', semLogin.status === 401, String(semLogin.status));
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
    await p.click('[data-modo=criar]');
    await p.fill('input[name=nome]', 'Teste');
    await p.fill('input[name=email]', email('c'));
    await p.fill('input[name=senha]', SENHA);
    await p.click('button[type=submit]');
    await p.waitForSelector('.segmentos', { timeout: 20000 });
    conferir('App: criar conta pela tela', true);

    await p.click('[data-acao=nova-tarefa]');
    await p.fill('#folha input[name=titulo]', 'Pagar conta de luz');
    await p.fill('#t-venc', dia(1));
    await p.fill('#t-hora', '18:00');
    await p.selectOption('#t-cat', { label: 'Contas' });
    await p.click('#folha button[type=submit]');
    await p.waitForSelector('.linha', { timeout: 15000 });
    await p.waitForTimeout(500);
    conferir('App: tarefa criada vai para Vencendo', (await p.locator('[aria-selected=true]').innerText()).includes('Vencendo'));
    conferir('App: horário aparece no prazo', (await p.locator('.lista').innerText()).includes('Vence amanhã às 18h'));
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
    conferir('App: mostra crédito e à vista', (await p.locator('.dois').innerText()).includes('No crédito'));

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
    await p.click('.dois-segmentos label:has-text("Entrada")');
    await p.fill('#g-valor', '200,00');
    await p.fill('#g-onde', 'Freela');
    await p.click('#folha button[type=submit]');
    const r5 = await resta();
    conferir('App: entrada de R$ 200 soma no saldo', r5 - r0 === 20000, `${r0} → ${r5}`);

    // Compra pelo Atalho, com o código desta conta, e o app recarrega ao voltar.
    const c = createClient(URL_SB, CONFIG.supabaseAnonKey, { auth: { persistSession: false } });
    await c.auth.signInWithPassword({ email: email('c'), password: SENHA });
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
    await foto('4-compras-automaticas');
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
  const r = await sql(`delete from auth.users where email like '${PREFIXO}%${DOMINIO}' returning email`);
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
