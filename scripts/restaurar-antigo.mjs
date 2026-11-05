// Volta a versão antiga do Camarada para o endereço principal (recurso "restaurar publicação" do
// Netlify) e confere o resultado. Os dados de cada pessoa ficam no Netlify Blobs do site e não mudam.
import { writeFile, mkdir } from 'node:fs/promises';

const SITE = 'camarada-organizador';
const ANTIGO = '6aeb794febaadc3ea7aa1a15'; // 04/11 18:28 "Tarefas com hora: avisos faltando 3h, 1h e 10min"
const PRINCIPAL = `https://${SITE}.netlify.app`;
const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
const nl = async (c, metodo = 'GET', aceitar) => {
  const r = await fetch(`https://api.netlify.com/api/v1${c}`, {
    method: metodo,
    headers: { authorization: `Bearer ${TOKEN}`, ...(aceitar ? { accept: aceitar } : {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Netlify ${metodo} ${c} → ${r.status} ${t}`);
  try { return JSON.parse(t); } catch { return t; }
};
const linhas = [];
const log = (s = '') => { console.log(s); linhas.push(s); };
await mkdir('resultado', { recursive: true });

const site = (await nl(`/sites?filter=all&name=${SITE}&per_page=100`)).find((s) => s.name === SITE);
log(`Antes: versão publicada ${site.published_deploy?.id} (${site.published_deploy?.title})`);
try {
  log(`netlify.toml da versão antiga:\n${await nl(`/deploys/${ANTIGO}/files/netlify.toml`, 'GET', 'application/vnd.bitballoon.v1.raw')}`);
} catch (e) { log(`(netlify.toml não lido: ${e.message})`); }

await nl(`/sites/${site.id}/deploys/${ANTIGO}/restore`, 'POST');
let publicado;
for (let i = 0; i < 30; i++) {
  publicado = (await nl(`/sites/${site.id}`)).published_deploy;
  if (publicado?.id === ANTIGO) break;
  await new Promise((r) => setTimeout(r, 2000));
}
log(`Depois: versão publicada ${publicado?.id} (${publicado?.title})`);
log(`Restaurada: ${publicado?.id === ANTIGO ? 'SIM' : 'NÃO'}`);

await new Promise((r) => setTimeout(r, 5000));
const html = await (await fetch(`${PRINCIPAL}/?v=${Date.now()}`)).text();
log(`Endereço principal mostra a versão antiga: ${html.includes('vista-tarefas') ? 'SIM' : 'NÃO'}`);
const estado = await fetch(`${PRINCIPAL}/api/estado`);
log(`Servidor antigo (contas e dados) responde: ${estado.status} ${await estado.text()}`);

// O selo do Netlify aparece? (nas duas versões, para comparar)
const { chromium, devices } = await import('playwright');
const nav = await chromium.launch();
for (const [nome, url] of [['principal', PRINCIPAL], ['app-novo-de-teste', 'https://6aecedac5e26e83c3faa42f5--camarada-organizador.netlify.app']]) {
  const ctx = await nav.newContext({ ...devices['iPhone 12'], locale: 'pt-BR' });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(4000);
  const selo = await p.evaluate(() => {
    const f = document.getElementById('nl-badge-frame');
    if (!f) return 'não aparece';
    const r = f.getBoundingClientRect();
    return `aparece (${Math.round(r.width)}x${Math.round(r.height)})`;
  });
  const hud = await p.evaluate(() => [...document.scripts].some((s) => s.src.includes('/.netlify/scripts/hud')));
  log(`Selo do Netlify em ${nome}: ${selo}; script do selo na página: ${hud ? 'sim' : 'não'}`);
  await p.screenshot({ path: `resultado/${nome}.png` });
  await ctx.close();
}
await nav.close();
await writeFile('resultado/RELATORIO.md', `${linhas.join('\n')}\n`);
