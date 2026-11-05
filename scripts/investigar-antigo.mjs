// Só leitura: os avisos da versão antiga voltaram a rodar depois da restauração (~21:25 UTC de 05/11)?
import { writeFile, mkdir } from 'node:fs/promises';
import { getStore } from '@netlify/blobs';

const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
const site = (await (await fetch('https://api.netlify.com/api/v1/sites?filter=all&name=camarada-organizador', { headers: { authorization: `Bearer ${TOKEN}` } })).json())
  .find((s) => s.name === 'camarada-organizador');
const loja = getStore({ name: 'camarada', siteID: site.id, token: TOKEN });
const linhas = [`Versão publicada: ${site.published_deploy?.id} (${site.published_deploy?.title})`, `Agora: ${new Date().toISOString()}`];
for (const chave of ['u-372495ab57f5d279-avisos', 'u-90ba7893a6ba233a-avisos']) {
  const v = await loja.get(chave, { type: 'json' });
  const r = v?.ultimo_resultado;
  // Só datas e números: nada de conteúdo pessoal.
  const resumo = r && typeof r === 'object'
    ? Object.fromEntries(Object.entries(r).map(([k, x]) => [k, typeof x === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(x) ? `texto(${x.length})` : Array.isArray(x) ? `lista(${x.length})` : x]))
    : r;
  linhas.push(`${chave}: ultimo_dia=${v?.ultimo_dia} ultimo_resultado=${JSON.stringify(resumo)} enviados=${Array.isArray(v?.enviados) ? v.enviados.length : typeof v?.enviados === 'object' && v?.enviados ? Object.keys(v.enviados).length : v?.enviados}`);
}
const { blobs } = await loja.list();
linhas.push(`Itens na loja: ${blobs.length}`);
console.log(linhas.join('\n'));
await mkdir('investigacao', { recursive: true });
await writeFile('investigacao/RELATORIO.md', `${linhas.join('\n')}\n`);
