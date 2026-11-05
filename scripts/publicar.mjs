// Publica tudo sozinho (roda no GitHub Actions, ver .github/workflows/publicar.yml):
//  1. Cria (ou reaproveita) o projeto "camarada-app" no Supabase
//  2. Aplica as migrações do banco que ainda não foram aplicadas
//  3. Configura login (endereço do site, sem confirmação por e-mail)
//  4. Gera chaves de notificação e o segredo dos avisos (só na primeira vez)
//  5. Publica as funções registrar-compra e notificar
//  6. Agenda os avisos diários às 9h (Brasília) dentro do próprio banco
//  7. Escreve web/config.js e publica no endereço de TESTE do Netlify (nunca no principal)
//
// Precisa de: SUPABASE_ACCESS_TOKEN, NETLIFY_AUTH_TOKEN.
import { readFile, writeFile, readdir, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';

const SUPABASE = process.env.SUPABASE_API_URL || 'https://api.supabase.com/v1';
const NETLIFY = process.env.NETLIFY_API_URL || 'https://api.netlify.com/api/v1';
const NOME_PROJETO = 'camarada-app';
const REGIAO = 'sa-east-1'; // São Paulo
// O app novo vai SÓ para um endereço de teste dentro do site camarada-organizador:
// https://teste--camarada-organizador.netlify.app. O endereço principal fica com a versão antiga,
// que as pessoas usam; esta publicação nunca o substitui (não existe "--prod" aqui).
const SITE = 'camarada-organizador';
const APELIDO = 'teste';
const URL_TESTE = `https://${APELIDO}--${SITE}.netlify.app`;
const tokenSb = process.env.SUPABASE_ACCESS_TOKEN;
const tokenNl = process.env.NETLIFY_AUTH_TOKEN;

const espera = (ms) => new Promise((r) => setTimeout(r, process.env.PUBLICAR_RAPIDO ? 1 : ms));
const passo = (t) => console.log(`\n▶ ${t}`);
const resumo = async (linha) => {
  console.log(linha);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${linha}\n`);
};

async function chamar(base, token, metodo, caminho, corpo) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let dados;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
  if (!r.ok) {
    const erro = new Error(`${metodo} ${caminho} → ${r.status}: ${typeof dados === 'string' ? dados : JSON.stringify(dados)}`);
    erro.status = r.status;
    throw erro;
  }
  return dados;
}
const sb = (m, c, b) => chamar(SUPABASE, tokenSb, m, c, b);
const nl = (m, c, b) => chamar(NETLIFY, tokenNl, m, c, b);

async function sql(ref, query, tentativas = 6) {
  for (let i = 1; ; i++) {
    try {
      return await sb('POST', `/projects/${ref}/database/query`, { query });
    } catch (e) {
      if (i >= tentativas || (e.status && e.status < 500 && e.status !== 408)) throw e;
      console.log(`  banco ainda não respondeu (${e.status ?? e.message}); tentando de novo…`);
      await espera(10_000);
    }
  }
}

const literal = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ---------------------------------------------------------------- 1. projeto

async function garantirProjeto() {
  passo('Projeto no Supabase');
  const projetos = await sb('GET', '/projects');
  let projeto = projetos.find((p) => p.name === NOME_PROJETO);
  if (projeto) {
    console.log(`  usando o projeto existente ${projeto.id}`);
  } else {
    const orgs = await sb('GET', '/organizations');
    if (!orgs.length) throw new Error('Sua conta do Supabase não tem nenhuma organização. Crie uma em supabase.com/dashboard.');
    const org = orgs[0];
    console.log(`  criando "${NOME_PROJETO}" na organização "${org.name}" (São Paulo)…`);
    const base = { name: NOME_PROJETO, db_pass: randomBytes(24).toString('base64url'), region: REGIAO };
    try {
      projeto = await sb('POST', '/projects', { ...base, organization_id: org.id });
    } catch (e) {
      if (e.status !== 400 && e.status !== 422) throw e;
      console.log(`  a API recusou organization_id (${e.message}); tentando organization_slug`);
      projeto = await sb('POST', '/projects', { ...base, organization_slug: org.slug ?? org.id });
    }
  }
  const ref = projeto.id ?? projeto.ref;
  for (let i = 0; i < 60; i++) {
    const p = await sb('GET', `/projects/${ref}`);
    if (p.status === 'ACTIVE_HEALTHY') return ref;
    if (/PAUSED|INACTIVE/.test(p.status)) {
      throw new Error(`O projeto ${ref} está pausado. Abra supabase.com/dashboard e clique em "Restore project".`);
    }
    console.log(`  aguardando o projeto ficar pronto (${p.status})…`);
    await espera(10_000);
  }
  throw new Error('O projeto demorou mais de 10 minutos para ficar pronto. Rode a publicação de novo.');
}

// ---------------------------------------------------------------- 2. migrações

async function aplicarMigracoes(ref) {
  passo('Banco de dados');
  await sql(ref, `
    create schema if not exists camarada_interno;
    create table if not exists camarada_interno.migracoes (nome text primary key, aplicada_em timestamptz not null default now());
    revoke all on schema camarada_interno from anon, authenticated;`);
  const feitas = new Set((await sql(ref, 'select nome from camarada_interno.migracoes')).map((l) => l.nome));
  const arquivos = (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const arquivo of arquivos) {
    if (feitas.has(arquivo)) { console.log(`  ✓ ${arquivo} (já aplicada)`); continue; }
    const conteudo = await readFile(`supabase/migrations/${arquivo}`, 'utf8');
    await sql(ref, `begin;\n${conteudo}\ninsert into camarada_interno.migracoes (nome) values (${literal(arquivo)});\ncommit;`, 1);
    console.log(`  ✓ ${arquivo} (aplicada agora)`);
  }
}

// ---------------------------------------------------------------- 3. login

async function configurarLogin(ref, urlSite) {
  passo('Login');
  await sb('PATCH', `/projects/${ref}/config/auth`, {
    site_url: urlSite,
    uri_allow_list: `${urlSite}/**`,
    // O e-mail gratuito do Supabase só envia para membros da equipe; sem isso ninguém conseguiria entrar.
    mailer_autoconfirm: true,
  });
  console.log(`  endereço do site: ${urlSite}; contas novas entram sem confirmar e-mail`);
}

// ---------------------------------------------------------------- 4. segredos

function novasChavesVapid() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const privada = ecdh.getPrivateKey();
  const privada32 = Buffer.concat([Buffer.alloc(32 - privada.length), privada]);
  return { publica: ecdh.getPublicKey().toString('base64url'), privada: privada32.toString('base64url') };
}

async function garantirSegredos(ref, configAtual, urlSite) {
  passo('Chaves de notificação e segredo dos avisos');
  const existentes = new Set((await sb('GET', `/projects/${ref}/secrets`)).map((s) => s.name));
  const novos = [];
  let vapidPublica = configAtual.vapidPublicKey;
  if (!existentes.has('VAPID_PRIVATE_KEY') || !vapidPublica) {
    const { publica, privada } = novasChavesVapid();
    vapidPublica = publica;
    novos.push({ name: 'VAPID_PUBLIC_KEY', value: publica }, { name: 'VAPID_PRIVATE_KEY', value: privada });
    console.log('  chaves de notificação geradas');
  }
  if (!existentes.has('VAPID_SUBJECT')) novos.push({ name: 'VAPID_SUBJECT', value: urlSite });
  let segredoCron = null;
  const [{ n: noCofre }] = await sql(ref, "select count(*)::int as n from vault.secrets where name = 'camarada_cron_secret'");
  if (!existentes.has('CRON_SECRET') || !noCofre) {
    segredoCron = randomBytes(32).toString('hex');
    novos.push({ name: 'CRON_SECRET', value: segredoCron });
    console.log('  segredo dos avisos gerado');
  }
  if (novos.length) await sb('POST', `/projects/${ref}/secrets`, novos);
  else console.log('  tudo já configurado');
  return { vapidPublica, segredoCron };
}

// ---------------------------------------------------------------- 5. funções

function publicarFuncoes(ref) {
  passo('Funções do servidor');
  for (const f of ['registrar-compra', 'notificar']) {
    execFileSync('supabase', ['functions', 'deploy', f, `--remote=${ref}`, '--no-verify-jwt', '--use-api', '--yes'], { stdio: 'inherit' });
    console.log(`  ✓ ${f}`);
  }
}

// ---------------------------------------------------------------- 6. avisos diários

async function agendarAvisos(ref, segredoCron) {
  passo('Avisos diários (9h de Brasília)');
  await sql(ref, `
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;`);
  if (segredoCron) {
    await sql(ref, `
      do $v$
      declare existente uuid;
      begin
        select id into existente from vault.secrets where name = 'camarada_cron_secret';
        if existente is null then perform vault.create_secret(${literal(segredoCron)}, 'camarada_cron_secret');
        else perform vault.update_secret(existente, ${literal(segredoCron)});
        end if;
      end $v$;`);
  }
  const url = `https://${ref}.supabase.co/functions/v1/notificar`;
  await sql(ref, `
    select cron.schedule('camarada-avisos', '0 12 * * *', $cron$
      select net.http_post(
        url := ${literal(url)},
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'camarada_cron_secret')),
        body := '{}'::jsonb)
    $cron$);`);
  console.log('  ✓ agendado');
}

// ---------------------------------------------------------------- 7. app e site

async function chaveAnon(ref) {
  const chaves = await sb('GET', `/projects/${ref}/api-keys?reveal=true`);
  const anon = chaves.find((k) => k.name === 'anon' && k.api_key)
    ?? chaves.find((k) => k.type === 'publishable' && k.api_key);
  if (!anon) throw new Error('Não encontrei a chave pública (anon) do projeto.');
  return anon.api_key;
}

async function lerConfig() {
  const { CONFIG } = await import(`../web/config.js?${Date.now()}`);
  return { ...CONFIG };
}

async function escreverConfig(config) {
  const atual = await readFile('web/config.js', 'utf8');
  const novo = atual.replace(/export const CONFIG = \{[\s\S]*?\n\};/, () =>
    `export const CONFIG = {\n${Object.entries(config).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join('\n')}\n};`);
  if (novo !== atual) {
    await writeFile('web/config.js', novo);
    console.log('  web/config.js atualizado');
  }
}

async function acharSite() {
  passo('Site no Netlify');
  const sites = await nl('GET', `/sites?filter=all&name=${encodeURIComponent(SITE)}&per_page=100`);
  const site = sites.find((s) => s.name === SITE);
  if (!site) throw new Error(`O site "${SITE}" não está nesta conta do Netlify.`);
  console.log(`  versão no endereço principal (não muda): ${site.published_deploy?.title ?? site.published_deploy?.id}`);
  return site;
}

function publicarTeste(site) {
  const args = ['--yes', 'netlify-cli@17.38.1', 'deploy', '--dir', 'web', '--alias', APELIDO,
    '--site', site.id, '--auth', tokenNl, '--message', `Teste ${process.env.GITHUB_SHA?.slice(0, 7) ?? ''}`];
  if (args.some((a) => /^--prod/.test(a))) throw new Error('Publicação no endereço principal bloqueada.');
  execFileSync('npx', args, { stdio: 'inherit' });
}

async function conferirPrincipalIntacto(site, antes) {
  const depois = (await nl('GET', `/sites/${site.id}`)).published_deploy?.id;
  if (depois !== antes) throw new Error(`O endereço principal mudou de versão (${antes} → ${depois})!`);
  console.log('  endereço principal continua com a mesma versão ✓');
}

// ---------------------------------------------------------------- principal

async function principal() {
  if (!tokenSb || !tokenNl) {
    await resumo('⚠️ Faltam os segredos SUPABASE_ACCESS_TOKEN e/ou NETLIFY_AUTH_TOKEN. Veja docs/PUBLICAR.md.');
    return;
  }
  const site = await acharSite();
  const versaoPrincipal = site.published_deploy?.id;
  const urlSite = URL_TESTE;
  const ref = await garantirProjeto();
  await aplicarMigracoes(ref);
  await configurarLogin(ref, urlSite);
  const config = await lerConfig();
  const { vapidPublica, segredoCron } = await garantirSegredos(ref, config, urlSite);
  publicarFuncoes(ref);
  await agendarAvisos(ref, segredoCron);

  passo('Configuração do app');
  await escreverConfig({
    ...config,
    supabaseUrl: `https://${ref}.supabase.co`,
    supabaseAnonKey: await chaveAnon(ref),
    vapidPublicKey: vapidPublica,
  });

  passo('Publicando no endereço de teste');
  publicarTeste(site);
  await conferirPrincipalIntacto(site, versaoPrincipal);

  await resumo('## ✅ Camarada (teste) publicado');
  await resumo(`- Endereço de teste: ${urlSite}`);
  await resumo('- Endereço principal: não foi alterado');
  await resumo(`- Projeto Supabase: ${ref}`);
  await resumo(`- Endereço para o Atalho do iPhone: https://${ref}.supabase.co/functions/v1/registrar-compra`);
}

principal().catch(async (e) => {
  console.error(`\n✗ ${e.message}`);
  await resumo(`## ✗ Falhou\n\n${e.message}`);
  process.exit(1);
});
