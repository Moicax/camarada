// Só leitura: tentativas recentes do Atalho do Apple Pay (formato e motivo). Log público: só tipos e status.
import { CONFIG } from '../web/config.js';
const REF = new URL(CONFIG.supabaseUrl).hostname.split('.')[0];
const H = { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' };
const sql = async (query) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: H, body: JSON.stringify({ query }) })).json();
const linhas = await sql(`select to_char(criado_em at time zone 'America/Sao_Paulo','HH24:MI:SS') as hora, status, motivo, formato
  from public.tentativas_atalho order by criado_em desc limit 10`);
for (const l of Array.isArray(linhas) ? linhas : [linhas]) {
  const campos = Object.fromEntries(Object.entries(l.formato?.campos ?? {}).map(([k, v]) => [k, String(v).split(':')[0]]));
  console.log(`TENTATIVA ${l.hora} status=${l.status} motivo=${l.motivo ?? '-'} tipo=${l.formato?.tipo} campos=${JSON.stringify(campos)}`);
}
console.log(`TOTAL ${Array.isArray(linhas) ? linhas.length : JSON.stringify(linhas)}`);
