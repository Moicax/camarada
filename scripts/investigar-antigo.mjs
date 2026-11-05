// Só leitura: descobre onde a versão antiga do site guardava os dados.
// Lista as publicações do site no Netlify, abre as versões antigas pelo endereço
// permanente de cada uma e procura para onde o app mandava os dados.
import { writeFile, mkdir } from 'node:fs/promises';

const SITE = process.env.NETLIFY_SITE_NAME || 'camarada-organizador';
const nl = async (c) => {
  const r = await fetch(`https://api.netlify.com/api/v1${c}`, { headers: { authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}` } });
  if (!r.ok) throw new Error(`Netlify ${c} → ${r.status} ${await r.text()}`);
  return r.json();
};
const sb = async (c, metodo = 'GET', corpo) => {
  const r = await fetch(`https://api.supabase.com/v1${c}`, {
    method: metodo,
    headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const t = await r.text();
  return { status: r.status, dados: (() => { try { return JSON.parse(t); } catch { return t; } })() };
};
const linhas = [];
const log = (s = '') => { console.log(s); linhas.push(s); };

const sites = await nl(`/sites?filter=all&name=${SITE}&per_page=100`);
const site = sites.find((s) => s.name === SITE);
log(`# Site ${site.name} (criado em ${site.created_at})`);
const deploys = await nl(`/sites/${site.id}/deploys?per_page=100`);
log(`\n## ${deploys.length} publicações (mais recente primeiro)`);
for (const d of deploys) {
  log(`- ${d.created_at} · ${d.state} · ${d.context} · "${(d.title || d.commit_ref || '').slice(0, 60)}" · ${d.deploy_ssl_url}`);
}

const nossas = (d) => /^GitHub /.test(d.title || '');
const antigas = deploys.filter((d) => d.state === 'ready' && !nossas(d)).slice(0, 4);
const hosts = new Map();
for (const d of antigas) {
  log(`\n## Versão antiga ${d.id} (${d.created_at})`);
  const base = d.deploy_ssl_url;
  const visitados = new Set();
  const fila = ['/'];
  const achados = { supabase: new Set(), armazenamento: new Set(), urls: new Set() };
  while (fila.length && visitados.size < 40) {
    const caminho = fila.shift();
    if (visitados.has(caminho)) continue;
    visitados.add(caminho);
    let texto;
    try {
      const r = await fetch(new URL(caminho, base));
      if (!r.ok) continue;
      texto = await r.text();
    } catch { continue; }
    for (const m of texto.matchAll(/(?:src|href)=["']([^"']+\.(?:js|mjs|json|webmanifest))["']/g)) {
      if (!/^https?:/.test(m[1]) || m[1].startsWith(base)) fila.push(new URL(m[1], new URL(caminho, base)).pathname);
    }
    for (const m of texto.matchAll(/(?:import|from)\s*\(?\s*["'](\.{0,2}\/[^"']+\.m?js)["']/g)) fila.push(new URL(m[1], new URL(caminho, base)).pathname);
    for (const m of texto.matchAll(/https:\/\/([a-z0-9]{20})\.supabase\.co/g)) achados.supabase.add(m[1]);
    for (const m of texto.matchAll(/\b(localStorage|indexedDB|sessionStorage)\b/g)) achados.armazenamento.add(`${m[1]} em ${caminho}`);
    for (const m of texto.matchAll(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi)) {
      const h = new URL(m[0]).hostname;
      if (!/w3\.org|netlify|jsdelivr|unpkg|googleapis|gstatic|apple\.com|example/.test(h)) achados.urls.add(h);
    }
  }
  log(`Arquivos lidos: ${[...visitados].join(', ')}`);
  log(`Projetos Supabase citados: ${[...achados.supabase].join(', ') || 'nenhum'}`);
  log(`Armazenamento no aparelho: ${[...achados.armazenamento].join('; ') || 'nenhum'}`);
  log(`Outros servidores citados: ${[...achados.urls].join(', ') || 'nenhum'}`);
  for (const ref of achados.supabase) hosts.set(ref, d.created_at);
}

log('\n## Projetos Supabase da sua conta (chave cadastrada no GitHub)');
const projetos = await sb('/projects');
for (const p of projetos.dados ?? []) log(`- ${p.name} · ${p.id} · ${p.status} · criado em ${p.created_at}`);
for (const [ref] of hosts) {
  const meu = (projetos.dados ?? []).find((p) => p.id === ref);
  log(`\n## Banco antigo ${ref}: ${meu ? `está na sua conta (${meu.status})` : 'NÃO está na conta desta chave'}`);
  if (meu && meu.status === 'ACTIVE_HEALTHY') {
    const q = await sb(`/projects/${ref}/database/query`, 'POST', { query: `
      select 'auth.users' as tabela, count(*)::int as linhas from auth.users
      union all select schemaname || '.' || relname, n_live_tup::int from pg_stat_user_tables where schemaname = 'public'
      order by 1` });
    log(JSON.stringify(q.dados));
    const u = await sb(`/projects/${ref}/database/query`, 'POST', { query: `
      select left(email, 2) || '…@' || split_part(email, '@', 2) as email, created_at::date as criada, last_sign_in_at::date as ultimo_acesso
      from auth.users order by created_at` });
    log(`Contas (e-mail parcial): ${JSON.stringify(u.dados)}`);
  }
}

await mkdir('investigacao', { recursive: true });
await writeFile('investigacao/RELATORIO.md', `${linhas.join('\n')}\n`);
