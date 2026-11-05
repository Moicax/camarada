// Recebe uma compra feita com Apple Pay, enviada pelo Atalho do iPhone.
//
// POST /functions/v1/registrar-compra
// { "token": "<código da pessoa>", "valor": "R$ 23,90", "estabelecimento": "Padaria", "cartao": "Nubank" }
//
// Publicar com: supabase functions deploy registrar-compra --no-verify-jwt
// (a segurança vem do código pessoal, não do login, porque o Atalho não faz login).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { lerValor, nomeCartao, resumoMes, formatarReal } from '../_shared/finance.js';
import { diaLocal, chaveMes } from '../_shared/dates.js';
import { enviarPush } from '../_shared/push.ts';

const FUSO = 'America/Sao_Paulo';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

function resposta(status: number, corpo: Record<string, unknown>) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function texto(v: unknown, max: number) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta(405, { ok: false, erro: 'Use POST' });

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return resposta(400, { ok: false, erro: 'Corpo precisa ser JSON' });
  }

  const token = texto(corpo.token, 100);
  if (!token || !/^[0-9a-f]{48}$/.test(token)) {
    return resposta(401, { ok: false, erro: 'Código do Camarada inválido. Copie de novo no app.' });
  }

  const { data: perfil, error: erroPerfil } = await supabase
    .from('perfis')
    .select('user_id, renda_mensal')
    .eq('token_atalho', token)
    .maybeSingle();
  if (erroPerfil) return resposta(500, { ok: false, erro: 'Erro ao buscar conta' });
  if (!perfil) return resposta(401, { ok: false, erro: 'Código do Camarada não encontrado. Copie de novo no app.' });

  const valor = lerValor(corpo.valor as string);
  if (!Number.isFinite(valor) || valor === 0 || Math.abs(valor) > 1_000_000) {
    return resposta(400, { ok: false, erro: `Valor inválido: ${String(corpo.valor)}` });
  }

  const userId = perfil.user_id;
  const estabelecimento = texto(corpo.estabelecimento, 120);
  const cartao = nomeCartao(corpo.cartao as string);

  // Cartão marcado como débito em Ajustes: a compra sai do salário na hora (à vista).
  let cartaoId: string | null = null;
  let forma = 'credito';
  if (cartao) {
    const { data: c, error } = await supabase
      .from('cartoes')
      .upsert({ user_id: userId, nome: cartao }, { onConflict: 'user_id,nome' })
      .select('id, debito')
      .single();
    if (error) return resposta(500, { ok: false, erro: 'Erro ao salvar cartão' });
    cartaoId = c.id;
    if (c.debito) forma = 'avista';
  }

  const { error: erroGasto } = await supabase.from('gastos').insert({
    user_id: userId,
    valor,
    estabelecimento,
    cartao_id: cartaoId,
    forma,
    origem: 'atalho',
  });
  if (erroGasto) return resposta(500, { ok: false, erro: 'Erro ao salvar compra' });

  // Resumo do mês para a notificação: "hoje ainda dá para gastar R$ X".
  const hoje = diaLocal(new Date(), FUSO);
  const mes = chaveMes(hoje);
  const [ano, m] = mes.split('-').map(Number);
  const inicio = new Date(Date.UTC(ano, m - 1, 1) - 3 * 3600_000).toISOString();
  const fim = new Date(Date.UTC(ano, m, 1) + 3 * 3600_000).toISOString();

  const [{ data: gastos }, { data: rendaMes }] = await Promise.all([
    supabase.from('gastos').select('valor, data').eq('user_id', userId).gte('data', inicio).lt('data', fim),
    supabase.from('rendas_mes').select('valor').eq('user_id', userId).eq('mes', mes).maybeSingle(),
  ]);
  const renda = Number(rendaMes?.valor ?? perfil.renda_mensal ?? 0);
  const resumo = resumoMes({ renda, gastos: gastos ?? [], mes, hoje, timeZone: FUSO });

  const titulo = `${formatarReal(valor)}${estabelecimento ? ` · ${estabelecimento}` : ''}`;
  const detalhe =
    resumo.restaHoje === null
      ? 'Registrado em Finanças.'
      : resumo.restaHoje >= 0
        ? `Hoje ainda dá para gastar ${formatarReal(resumo.restaHoje)}.`
        : `Passou ${formatarReal(-resumo.restaHoje)} do limite de hoje.`;
  const mensagem = `${cartao ? `${cartao}${forma === 'avista' ? ' (débito)' : ''} · ` : ''}${detalhe}`;

  try {
    await enviarPush(supabase, userId, { titulo, corpo: mensagem, url: '/#financas', tag: 'compra' });
  } catch (e) {
    console.error('Compra salva, mas a notificação falhou', e);
  }

  return resposta(200, { ok: true, forma, mensagem: `${titulo} — ${mensagem}` });
});
