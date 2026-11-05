// Só leitura (2ª parte): baixa o código da última versão antiga e lista os dados guardados
// no Netlify (Netlify Blobs) — nomes, quantidades e tamanhos, sem alterar nada.
import { writeFile, mkdir } from 'node:fs/promises';
import { listStores, getStore } from '@netlify/blobs';

const SITE = 'camarada-organizador';
const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
const nl = async (c) => {
  const r = await fetch(`https://api.netlify.com/api/v1${c}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`Netlify ${c} → ${r.status} ${await r.text()}`);
  return r.json();
};
const linhas = [];
const log = (s = '') => { console.log(s); linhas.push(s); };
const mascarar = (s) => String(s).replace(/([A-Za-z0-9._%+-]{2})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+)/g, '$1…@$2');

await mkdir('investigacao/codigo-antigo', { recursive: true });
const site = (await nl(`/sites?filter=all&name=${SITE}&per_page=100`)).find((s) => s.name === SITE);
const deploys = await nl(`/sites/${site.id}/deploys?per_page=100`);
const antigo = deploys.find((d) => d.state === 'ready' && !/^GitHub /.test(d.title || ''));
log(`# Última versão antiga: ${antigo.id} (${antigo.created_at}) "${antigo.title}"`);
log(`Endereço permanente: ${antigo.deploy_ssl_url}`);
const detalhe = await nl(`/deploys/${antigo.id}`);
log(`Funções: ${JSON.stringify(detalhe.available_functions?.map((f) => f.n ?? f.name ?? f) ?? null)}`);
log(`Agendamentos: ${JSON.stringify(detalhe.function_schedules ?? null)}`);

const arquivos = await nl(`/deploys/${antigo.id}/files`);
log(`Arquivos: ${arquivos.map((f) => f.id).join(', ')}`);
for (const f of arquivos) {
  if (!/\.(js|mjs|html|json|webmanifest|toml|css)$/.test(f.id)) continue;
  const r = await fetch(`${antigo.deploy_ssl_url}${f.id}`);
  if (r.ok) await writeFile(`investigacao/codigo-antigo/${f.id.replace(/^\//, '').replace(/\//g, '__')}`, await r.text());
}

log('\n## Dados guardados no Netlify (Blobs)');
let lojas = [];
try {
  const res = await listStores({ siteID: site.id, token: TOKEN });
  lojas = res.stores ?? res;
} catch (e) { log(`listStores falhou: ${e.message}`); }
log(`Lojas: ${JSON.stringify(lojas)}`);
for (const nome of lojas) {
  const loja = getStore({ name: nome, siteID: site.id, token: TOKEN });
  const { blobs } = await loja.list();
  log(`\n### ${nome}: ${blobs.length} itens`);
  for (const b of blobs.slice(0, 60)) {
    let resumo = '';
    try {
      const v = await loja.get(b.key, { type: 'json' });
      resumo = Array.isArray(v) ? `lista com ${v.length}` : v && typeof v === 'object' ? `campos: ${Object.keys(v).slice(0, 15).join(', ')}` : typeof v;
      if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) if (Array.isArray(x)) resumo += ` | ${k}: ${x.length}`;
      }
    } catch { resumo = '(não é JSON)'; }
    log(`- ${mascarar(b.key)} → ${resumo}`);
  }
}
await writeFile('investigacao/RELATORIO.md', `${linhas.join('\n')}\n`);
