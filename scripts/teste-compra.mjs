// Compra de teste (R$ 1,00) na conta do dono, pelo mesmo servidor que recebe o Apple Pay.
// Espera 15 minutos e apaga a compra. O log é público: só mostra contagens e situação.
import { CONFIG } from '../web/config.js';

const REF = new URL(CONFIG.supabaseUrl).hostname.split('.')[0];
const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`SQL ${r.status}`);
  return r.json();
};

const [conta] = await sql(`select p.user_id, p.token_atalho,
    (select count(*)::int from public.inscricoes_push i where i.user_id = p.user_id) as aparelhos
  from public.perfis p join public.contas_antigas a on a.user_id = p.user_id where p.dono`);
if (!conta) throw new Error('Conta do dono não encontrada');
console.log(`Aparelhos com notificação ativa nesta conta: ${conta.aparelhos}`);

const r = await fetch(`${CONFIG.supabaseUrl}/functions/v1/registrar-compra`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: conta.token_atalho, valor: 'R$ 1,00', estabelecimento: 'Teste do Camarada (some em 15 min)' }),
});
const corpo = await r.json().catch(() => ({}));
console.log(`Servidor: ${r.status} ${corpo.ok ? 'compra registrada' : corpo.erro ?? ''}`);
const [{ n }] = await sql(`select count(*)::int as n from public.gastos where user_id = '${conta.user_id}'
  and estabelecimento = 'Teste do Camarada (some em 15 min)'`);
console.log(`Compra de teste na conta: ${n === 1 ? 'sim' : `não (${n})`}`);
console.log(`Notificação: ${conta.aparelhos ? 'enviada para o iPhone' : 'não enviada (nenhum aparelho ativou as notificações no app novo)'}`);

await new Promise((ok) => { setTimeout(ok, 15 * 60_000); });
const apagadas = await sql(`delete from public.gastos where user_id = '${conta.user_id}'
  and estabelecimento = 'Teste do Camarada (some em 15 min)' returning id`);
console.log(`Compra de teste apagada: ${apagadas.length}`);
