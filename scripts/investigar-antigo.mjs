// Só leitura (3ª parte): a versão antiga ainda responde no endereço permanente dela?
import { writeFile, mkdir } from 'node:fs/promises';
const ANTIGO = 'https://6aeb794febaadc3ea7aa1a15--camarada-organizador.netlify.app';
const linhas = [];
const log = (s) => { console.log(s); linhas.push(s); };
for (const caminho of ['/', '/app.js', '/api/estado']) {
  const r = await fetch(ANTIGO + caminho);
  const t = await r.text();
  log(`GET ${caminho} → ${r.status} ${caminho === '/api/estado' ? t.slice(0, 200) : `(${t.length} bytes)`}`);
}
const atual = await fetch('https://camarada-organizador.netlify.app/api/estado');
log(`Endereço principal /api/estado → ${atual.status} (a versão nova não tem essas funções)`);
await mkdir('investigacao', { recursive: true });
await writeFile('investigacao/RELATORIO.md', `${linhas.join('\n')}\n`);
