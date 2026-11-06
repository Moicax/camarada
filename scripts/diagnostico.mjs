// Só leitura: o app antigo já recebia compras do Apple Pay? (contagens e datas, sem valores)
import { CONFIG } from '../web/config.js';
const REF = new URL(CONFIG.supabaseUrl).hostname.split('.')[0];
const H = { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' };
const sql = async (query) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: H, body: JSON.stringify({ query }) })).json();
console.log('Apple Pay por conta:', JSON.stringify(await sql(`select p.dono, g.origem, count(*)::int as n,
  to_char(max(g.criado_em) at time zone 'America/Sao_Paulo','DD/MM HH24:MI') as ultima
  from public.gastos g join public.perfis p on p.user_id = g.user_id join public.contas_antigas a on a.user_id = p.user_id
  group by 1, 2 order by 1, 2`)));
console.log('Atalho antigo guardado:', JSON.stringify(await sql(`select p.dono, a.atalho_hash is not null as tem from public.contas_antigas a join public.perfis p using (user_id)`)));
