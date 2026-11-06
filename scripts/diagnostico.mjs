// Só leitura: compras do Apple Pay da última meia hora (horário, origem, valor aproximado).
import { CONFIG } from '../web/config.js';
const REF = new URL(CONFIG.supabaseUrl).hostname.split('.')[0];
const H = { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' };
const sql = async (query) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: H, body: JSON.stringify({ query }) })).json();
console.log('Compras recentes:', JSON.stringify(await sql(`select to_char(g.criado_em at time zone 'America/Sao_Paulo','HH24:MI:SS') as hora, g.origem,
  (g.valor = 1.04) as e_1_04, g.forma, (g.estabelecimento is not null) as tem_loja, (g.cartao_id is not null) as tem_cartao, p.dono
  from public.gastos g join public.perfis p on p.user_id = g.user_id where g.criado_em > now() - interval '30 minutes' order by g.criado_em`)));
console.log('Aparelhos com notificação:', JSON.stringify(await sql(`select p.dono, count(i.id)::int as n from public.perfis p left join public.inscricoes_push i on i.user_id = p.user_id join public.contas_antigas a on a.user_id = p.user_id group by p.dono`)));
