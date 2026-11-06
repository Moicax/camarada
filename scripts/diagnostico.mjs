// Só leitura: chegou compra do Apple Pay? O log é público: só mostra situação, horários e códigos.
import { CONFIG } from '../web/config.js';
const REF = new URL(CONFIG.supabaseUrl).hostname.split('.')[0];
const H = { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' };
const sql = async (query) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: H, body: JSON.stringify({ query }) })).json();

console.log('Compras da última hora (todas as contas):', JSON.stringify(await sql(`
  select to_char(g.criado_em at time zone 'America/Sao_Paulo','HH24:MI') as hora, g.origem, (g.valor between 17 and 19) as perto_de_18, p.dono
  from public.gastos g join public.perfis p on p.user_id = g.user_id
  where g.criado_em > now() - interval '90 minutes' order by g.criado_em`)));
console.log('Aparelhos com notificação:', JSON.stringify(await sql(`select p.dono, count(i.id)::int as n from public.perfis p left join public.inscricoes_push i on i.user_id = p.user_id join public.contas_antigas a on a.user_id = p.user_id group by p.dono`)));

const q = encodeURIComponent(`select timestamp, m.function_id, r.method, r.url, resp.status_code
  from function_edge_logs cross join unnest(metadata) as m cross join unnest(m.request) as r cross join unnest(m.response) as resp
  where timestamp > timestamp_sub(current_timestamp(), interval 90 minute) order by timestamp desc limit 40`);
const logs = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs.all?sql=${q}`, { headers: H })).json();
for (const l of logs.result ?? []) {
  const quando = new Date(Number(l.timestamp) / 1000).toISOString().slice(11, 19);
  console.log(`${quando} UTC ${l.method} ${String(l.url).replace(/legado\/[\w-]+/, 'legado/<segredo>').replace(/^https?:\/\/[^/]+/, '')} → ${l.status_code}`);
}
if (logs.error) console.log('logs:', JSON.stringify(logs.error).slice(0, 300));
