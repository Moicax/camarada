// Prévia do Camarada no PC: entrega as telas (pasta app), responde a API (rotas.js)
// guardando em arquivos JSON (pasta dados), roda os avisos de 10 em 10 minutos e os lembretes de hora a cada minuto.
// Uso: node servidor/servidor.js   (porta 4820; PORT, HOST, CAMARADA_DADOS e CAMARADA_URL mudam isso)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tratar } from './rotas.js';
import { armazemArquivos } from './armazem-arquivos.js';
import { rodadaDeTodos, lembretesDeTodos } from './avisos.js';
import { migrarContaUnica } from './contas.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA_APP = path.join(RAIZ, 'app');
const armazem = armazemArquivos(process.env.CAMARADA_DADOS || path.join(RAIZ, 'dados'));
const PORTA = Number(process.env.PORT) || 4820;
const HOST = process.env.HOST || '127.0.0.1';
const SITE = process.env.CAMARADA_URL || `http://127.0.0.1:${PORTA}`;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};
// Os mesmos cabeçalhos ficam no netlify.toml para a versão na nuvem.
const SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};

async function paraRequest(req) {
  const partes = [];
  for await (const p of req) partes.push(p);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  return new Request(`http://${req.headers.host || 'local'}${req.url}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(partes)
  });
}

async function arquivo(res, rota) {
  const alvo = path.normalize(path.join(PASTA_APP, rota === '/' ? '/index.html' : rota));
  if (!alvo.startsWith(PASTA_APP + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const conteudo = await readFile(alvo);
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEGURANCA });
    res.end(conteudo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  }
}

http.createServer(async (req, res) => {
  try {
    const rota = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    if (!rota.startsWith('/api/')) return await arquivo(res, rota);
    const resposta = await tratar(await paraRequest(req), armazem, { site: SITE });
    res.writeHead(resposta.status, { ...Object.fromEntries(resposta.headers), ...SEGURANCA });
    res.end(Buffer.from(await resposta.arrayBuffer()));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Pedido inválido'); }
  }
}).listen(PORTA, HOST, () => console.log(`Camarada rodando em http://${HOST}:${PORTA}/`));

async function rodada() {
  try {
    await migrarContaUnica(armazem);
    const r = await rodadaDeTodos(armazem, { site: SITE });
    for (const [nome, x] of Object.entries(r)) if (x.avisos?.feito) console.log(`Avisos de ${nome}:`, JSON.stringify(x.avisos));
  } catch (e) { console.error('Falha nos avisos:', e); }
}
setTimeout(rodada, 5000);
setInterval(rodada, 10 * 60e3);

// Tarefas com hora: a cada minuto, como na nuvem.
setInterval(async () => {
  try {
    const r = await lembretesDeTodos(armazem, { site: SITE });
    for (const [nome, x] of Object.entries(r)) if (x?.lembretes || typeof x === 'string') console.log(`Lembretes de ${nome}:`, JSON.stringify(x));
  } catch (e) { console.error('Falha nos lembretes:', e); }
}, 60e3);
