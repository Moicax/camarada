// Leva o app único (antigo + novo) para o endereço principal: https://camarada-organizador.netlify.app
// Roda só quando o dono aprova (ramo "trocar-principal", ver .github/workflows/trocar-principal.yml).
//
//  1. Anota a versão que está no ar (para poder voltar em segundos, se precisar).
//  2. Copia de novo as contas do app antigo (só leitura lá), para não perder nada lançado até agora.
//  3. Publica a pasta web/ no endereço principal, logo em seguida.
//  4. Confere: o site novo abre, aponta para o servidor novo e o Atalho antigo do Apple Pay é repassado.
import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { CONFIG } from '../web/config.js';

const SITE = 'camarada-organizador';
const URL_PRINCIPAL = `https://${SITE}.netlify.app`;
const tokenNl = process.env.NETLIFY_AUTH_TOKEN;
const tokenSb = process.env.SUPABASE_ACCESS_TOKEN;
const REF = new URL(CONFIG.supabaseUrl).hostname.split('.')[0];

const resumo = async (linha) => {
  console.log(linha);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${linha}\n`);
};

async function nl(caminho) {
  const r = await fetch(`https://api.netlify.com/api/v1${caminho}`, { headers: { authorization: `Bearer ${tokenNl}` } });
  if (!r.ok) throw new Error(`Netlify ${caminho} → ${r.status}`);
  return r.json();
}

async function principal() {
  if (!tokenNl || !tokenSb) throw new Error('Faltam NETLIFY_AUTH_TOKEN e SUPABASE_ACCESS_TOKEN.');
  const site = (await nl(`/sites?filter=all&name=${SITE}`)).find((s) => s.name === SITE);
  const anterior = site.published_deploy?.id;
  await resumo(`Versão que estava no ar (para voltar, se precisar): ${anterior}`);

  console.log('\n▶ Copiando as contas do app antigo (versão mais recente)');
  execFileSync('node', ['scripts/copiar-antigo.mjs'], { stdio: 'inherit' });

  console.log('\n▶ Publicando no endereço principal');
  execFileSync('npx', ['--yes', 'netlify-cli@17.38.1', 'deploy', '--dir', 'web', '--prod', '--site', site.id,
    '--auth', tokenNl, '--message', `App único (antigo + novo) ${process.env.GITHUB_SHA?.slice(0, 7) ?? ''}`], { stdio: 'inherit' });

  console.log('\n▶ Conferindo o endereço principal');
  const novo = (await nl(`/sites/${site.id}`)).published_deploy?.id;
  const falhas = [];
  if (novo === anterior) falhas.push('a versão no ar não mudou');
  const html = await (await fetch(`${URL_PRINCIPAL}/?v=${Date.now()}`)).text();
  if (!html.includes('<title>Camarada</title>') || !html.includes('app.js')) falhas.push('a página não abriu');
  const cfg = await (await fetch(`${URL_PRINCIPAL}/config.js?v=${Date.now()}`)).text();
  if (!cfg.includes(REF)) falhas.push('o site não aponta para o servidor novo');
  // Atalho antigo do Apple Pay: o endereço /api/gasto/<segredo> tem que chegar ao servidor novo.
  // Com um segredo inventado, a resposta certa é 404 "Endereço não encontrado" vinda de lá.
  const atalho = await fetch(`${URL_PRINCIPAL}/api/gasto/conferencia-da-troca-${Date.now()}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"valor":"0,01"}',
  });
  const corpo = await atalho.json().catch(() => null);
  if (atalho.status !== 404 || !/Endereço não encontrado/.test(corpo?.erro ?? '')) {
    falhas.push(`o atalho antigo do Apple Pay não chegou ao servidor novo (${atalho.status})`);
  }
  if (falhas.length) throw new Error(`Depois da troca: ${falhas.join('; ')}. Para voltar: restaurar a versão ${anterior}.`);

  await resumo('## ✅ App único no endereço principal');
  await resumo(`- ${URL_PRINCIPAL} → versão ${novo}`);
  await resumo('- Contas do app antigo copiadas de novo logo antes da troca');
  await resumo('- Atalho antigo do Apple Pay repassado para o servidor novo ✓');
}

principal().catch(async (e) => {
  console.error(`\n✗ ${e.message}`);
  await resumo(`## ✗ Falhou\n\n${e.message}`);
  process.exit(1);
});
