// Só leitura: compras de hoje na conta do dono (hora, origem) e tentativas do Atalho.
import { CONFIG } from '../web/config.js';
const REF = new URL(CONFIG.supabaseUrl).hostname.split('.')[0];
const H = { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' };
const sql = async (query) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: H, body: JSON.stringify({ query }) })).json();
for (const l of await sql(`select to_char(g.criado_em at time zone 'America/Sao_Paulo','HH24:MI:SS') as hora, g.origem, (g.valor = 1.04) as e_1_04
  from public.gastos g join public.perfis p on p.user_id = g.user_id where p.dono and p.login is not null
  and g.criado_em > now() - interval '3 hours' order by g.criado_em`)) console.log(`COMPRA ${l.hora} origem=${l.origem} 1,04=${l.e_1_04}`);
for (const l of await sql(`select to_char(criado_em at time zone 'America/Sao_Paulo','HH24:MI:SS') as hora, status, motivo from public.tentativas_atalho
  where criado_em > now() - interval '40 minutes' order by criado_em`)) console.log(`TENTATIVA ${l.hora} status=${l.status} ${l.motivo ?? ''}`);
