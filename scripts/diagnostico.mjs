// Só leitura: compras do Apple Pay da última hora na conta do dono (hora e quantas), sem valores.
import { CONFIG } from '../web/config.js';
const REF = new URL(CONFIG.supabaseUrl).hostname.split('.')[0];
const H = { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' };
const sql = async (query) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: H, body: JSON.stringify({ query }) })).json();
for (const l of await sql(`select to_char(g.criado_em at time zone 'America/Sao_Paulo','HH24:MI:SS') as hora, g.origem, g.forma, (g.valor = 7.5) as e_7_50
  from public.gastos g join public.perfis p on p.user_id = g.user_id where p.dono and p.login is not null
  and g.criado_em > now() - interval '60 minutes' order by g.criado_em`)) console.log(`COMPRA ${l.hora} ${l.origem} ${l.forma} 7,50=${l.e_7_50}`);
for (const l of await sql(`select to_char(t.criado_em at time zone 'America/Sao_Paulo','HH24:MI:SS') as hora, t.status from public.tentativas_atalho t
  join public.perfis p on p.user_id = t.user_id where p.dono and p.login is not null and t.criado_em > now() - interval '60 minutes' order by 1`)) console.log(`TENTATIVA ${l.hora} ${l.status}`);
