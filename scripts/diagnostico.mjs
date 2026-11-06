// Só leitura: o código colado no Atalho é o da conta do dono? (só compara o começo; nada é mostrado)
import { CONFIG } from '../web/config.js';
const REF = new URL(CONFIG.supabaseUrl).hostname.split('.')[0];
const H = { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' };
const sql = async (query) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: H, body: JSON.stringify({ query }) })).json();
console.log('Começo do código bate com:', JSON.stringify(await sql(`select dono, (login is not null) as conta_por_nome, length(token_atalho) as tamanho
  from public.perfis where token_atalho like '583f221a0db0988%'`)));
// Simula o envio do Atalho com o código do dono, sem gravar: valor inválido → o servidor responde antes de salvar.
const [d] = await sql(`select token_atalho from public.perfis where dono and login is not null`);
const r = await fetch(`${CONFIG.supabaseUrl}/functions/v1/registrar-compra`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: d.token_atalho, valor: 'x' }) });
console.log('Servidor com o código do dono:', r.status, (await r.text()).slice(0, 120));
