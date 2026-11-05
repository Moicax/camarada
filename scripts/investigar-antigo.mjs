// Só leitura (4ª parte): código do servidor antigo, arquivos da versão antiga e o FORMATO dos
// dados guardados (sem conteúdo pessoal: textos viram "texto(n)", números viram "número").
import { writeFile, mkdir } from 'node:fs/promises';
import { listStores, getStore } from '@netlify/blobs';

const SITE = 'camarada-organizador';
const ANTIGO = '6aeb794febaadc3ea7aa1a15';
const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
const API = 'https://api.netlify.com/api/v1';
const linhas = [];
const log = (s = '') => { console.log(s); linhas.push(s); };
await mkdir('investigacao/antigo/funcoes', { recursive: true });

const site = (await (await fetch(`${API}/sites?filter=all&name=${SITE}`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()).find((s) => s.name === SITE);
const deploy = await (await fetch(`${API}/deploys/${ANTIGO}`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
log(`available_functions: ${JSON.stringify(deploy.available_functions)}`);
log(`campos do deploy: ${Object.keys(deploy).join(', ')}`);

// 1. Código das funções: tenta os caminhos possíveis da API.
const tentativas = [];
for (const f of deploy.available_functions ?? []) {
  const nome = f.n ?? f.name;
  tentativas.push(`/deploys/${ANTIGO}/functions/${nome}`, `/sites/${site.id}/functions/${nome}`, `/deploys/${ANTIGO}/functions/${nome}?download=true`);
  if (f.id) tentativas.push(`/deploys/${ANTIGO}/functions/${f.id}`);
}
tentativas.push(`/deploys/${ANTIGO}/functions`, `/sites/${site.id}/functions`);
for (const c of tentativas) {
  for (const accept of ['application/zip', 'application/json']) {
    const r = await fetch(API + c, { headers: { authorization: `Bearer ${TOKEN}`, accept } });
    const buf = Buffer.from(await r.arrayBuffer());
    const tipo = r.headers.get('content-type');
    log(`GET ${c} [${accept}] → ${r.status} ${tipo} ${buf.length} bytes ${tipo?.includes('json') || tipo?.includes('text') ? buf.toString('utf8').slice(0, 300) : ''}`);
    if (r.ok && buf.length > 200 && !tipo?.includes('html')) {
      await writeFile(`investigacao/antigo/funcoes/${c.replace(/[^a-z0-9]+/gi, '_')}_${accept.split('/')[1]}`, buf);
    }
  }
}

// 2. Arquivos da versão antiga (inclusive ícones) e o netlify.toml.
const arquivos = await (await fetch(`${API}/deploys/${ANTIGO}/files`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
for (const f of arquivos) {
  const destino = `investigacao/antigo/site${f.id}`;
  await mkdir(destino.slice(0, destino.lastIndexOf('/')), { recursive: true });
  let r = await fetch(`${deploy.deploy_ssl_url}${f.id}`);
  if (!r.ok || f.id === '/netlify.toml') {
    for (const h of [{ 'content-type': 'application/vnd.bitballoon.v1.raw' }, { accept: 'application/vnd.bitballoon.v1.raw' }]) {
      r = await fetch(`${API}/sites/${site.id}/files${f.id}`, { headers: { authorization: `Bearer ${TOKEN}`, ...h } });
      const t = Buffer.from(await r.arrayBuffer());
      log(`arquivo ${f.id} pela API ${JSON.stringify(h)} → ${r.status} ${r.headers.get('content-type')} ${t.length} bytes`);
      if (r.ok && !r.headers.get('content-type')?.includes('json')) { await writeFile(destino, t); break; }
    }
    continue;
  }
  await writeFile(destino, Buffer.from(await r.arrayBuffer()));
}

// 3. Formato dos dados (sem conteúdo pessoal).
const forma = (v, prof = 0) => {
  if (v === null) return null;
  if (Array.isArray(v)) return v.length ? [forma(v[0], prof + 1), `…${v.length} itens`] : [];
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, prof > 4 ? '…' : forma(x, prof + 1)]));
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return `data(${v.length})`;
    const partes = v.split(/[:$.]/);
    return partes.length > 1 ? `texto(${partes.map((p) => (/^[a-z0-9-]{1,12}$/i.test(p) && p.length < 12 ? p : `${p.length}`)).join('|')})` : `texto(${v.length})`;
  }
  return typeof v;
};
const lojas = (await listStores({ siteID: site.id, token: TOKEN })).stores;
for (const nome of lojas) {
  const loja = getStore({ name: nome, siteID: site.id, token: TOKEN });
  const { blobs } = await loja.list();
  const vistos = new Set();
  for (const b of blobs) {
    const tipo = b.key.replace(/^u-[0-9a-f]+-/, 'u-<id>-').replace(/^atalho-[0-9a-f]+/, 'atalho-<hash>').replace(/^conta-.+/, 'conta-<nome>').replace(/copia-\d{4}-\d{2}-\d{2}/, 'copia-<dia>');
    if (vistos.has(tipo)) continue;
    vistos.add(tipo);
    const v = await loja.get(b.key, { type: 'json' }).catch(() => null);
    log(`\n### ${tipo}\n${JSON.stringify(forma(v), null, 1)}`);
  }
  log(`\nchaves conta-*: ${blobs.filter((b) => b.key.startsWith('conta-')).map((b) => b.key).join(', ')}`);
}
await writeFile('investigacao/RELATORIO.md', `${linhas.join('\n')}\n`);
