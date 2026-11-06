// Reenvia ao servidor exatamente o que o iPhone mandou na tentativa recusada (mesmos campos e formato),
// confere se agora entra e apaga a compra reenviada. Log público: só status e sim/não.
import { CONFIG } from '../web/config.js';
const REF = new URL(CONFIG.supabaseUrl).hostname.split('.')[0];
const H = { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' };
const sql = async (query) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: H, body: JSON.stringify({ query }) })).json();

const [t] = await sql(`select user_id, formato from public.tentativas_atalho
  where status = 400 and motivo = 'valor' and user_id is not null order by criado_em desc limit 1`);
const [p] = await sql(`select token_atalho from public.perfis where user_id = '${t.user_id}'`);
const corpo = {};
for (const [k, v] of Object.entries(t.formato.campos)) {
  if (k.trim().toLowerCase() === 'token') { corpo[k] = p.token_atalho; continue; }
  const bruto = String(v).replace(/^\w+: /, '');
  try { corpo[k] = JSON.parse(bruto); } catch { corpo[k] = bruto.replace(/^"/, ''); }
}
console.log(`CAMPOS ${JSON.stringify(Object.keys(corpo))}`);
const valorEnviado = String(Object.entries(corpo).find(([k]) => k.trim().toLowerCase() === 'valor')?.[1] ?? '');
const esperado = Number(valorEnviado.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));

const [{ agora }] = await sql('select now()::text as agora');
const r = await fetch(`${CONFIG.supabaseUrl}/functions/v1/registrar-compra`, {
  method: 'POST', headers: { 'content-type': t.formato.tipo || 'application/json' }, body: JSON.stringify(corpo),
});
const resp = await r.json().catch(() => ({}));
console.log(`REENVIO status=${r.status} ok=${resp.ok === true} ${resp.ok ? '' : String(resp.erro ?? '').replace(/:.*/, '')}`);
const criadas = await sql(`select valor::float as valor, (estabelecimento is not null) as loja, (cartao_id is not null) as cartao
  from public.gastos where user_id = '${t.user_id}' and origem = 'atalho' and criado_em >= '${agora}'`);
for (const g of criadas) console.log(`REGISTRADA valor_igual_ao_do_iphone=${Math.abs(g.valor - esperado) < 0.001} loja=${g.loja} cartao=${g.cartao}`);
const apagadas = await sql(`delete from public.gastos where user_id = '${t.user_id}' and origem = 'atalho' and criado_em >= '${agora}' returning id`);
console.log(`APAGADA ${apagadas.length}`);
