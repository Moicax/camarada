// Servidor simples para testar o app no computador ou no celular (mesma rede Wi-Fi).
// Uso: npm run dev   (porta padrão 5173; outra porta: PORT=8080 npm run dev)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('../web/', import.meta.url));
const porta = Number(process.env.PORT) || 5173;
const tipos = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

createServer(async (req, res) => {
  const caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let arquivo = normalize(join(raiz, caminho));
  if (!arquivo.startsWith(raiz)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(arquivo)).isDirectory()) arquivo = join(arquivo, 'index.html');
    const corpo = await readFile(arquivo);
    res.writeHead(200, { 'content-type': tipos[extname(arquivo)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(corpo);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Não encontrado');
  }
}).listen(porta, '0.0.0.0', () => {
  console.log(`Camarada rodando em http://localhost:${porta}`);
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`No celular (mesmo Wi-Fi): http://${i.address}:${porta}`);
    }
  }
});
