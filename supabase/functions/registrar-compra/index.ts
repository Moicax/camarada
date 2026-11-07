// Recebe uma compra feita com Apple Pay, enviada pelo Atalho do iPhone.
//
// POST /functions/v1/registrar-compra
// { "token": "<código da pessoa>", "valor": "R$ 23,90", "estabelecimento": "Padaria", "cartao": "Nubank" }
//
// Também aceita o Atalho do app antigo, sem mudar nada no iPhone: o endereço antigo
// https://camarada-organizador.netlify.app/api/gasto/<segredo> é repassado pelo site para
// /functions/v1/registrar-compra/legado/<segredo>, com { "valor", "local", "cartao" }.
//
// Publicar com: supabase functions deploy registrar-compra --no-verify-jwt
// (a segurança vem do código pessoal, não do login, porque o Atalho não faz login).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { lerValor, nomeCartao, resumoMes, formatarReal, compromissosDoMes } from '../_shared/finance.js';
import { diaLocal, chaveMes } from '../_shared/dates.js';
import { enviarPush } from '../_shared/push.ts';
import { conferirMeta } from '../_shared/meta.ts';
import { resumoAtalhoAntigo } from '../_shared/senha-antiga.js';

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

// O Atalhos manda JSON; se vier como formulário ou só o número, também entende (como no app antigo).
async function lerCorpo(req: Request): Promise<Record<string, unknown>> {
  const bruto = (await req.text()).slice(0, 10_000);
  try {
    const j = JSON.parse(bruto);
    if (j && typeof j === 'object') return j;
    return { valor: j };
  } catch { /* não é JSON */ }
  const form = Object.fromEntries(new URLSearchParams(bruto));
  return Object.keys(form).length > 1 ? form : { valor: bruto };
}

// Nome do campo como a pessoa digitou no Atalhos: sem ligar para maiúsculas, acentos ou espaços
// sobrando ("Valor ", "cartão" e "valor" são o mesmo campo).
const nomeCampo = (k: string) => k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Primeiro campo preenchido entre vários nomes possíveis.
function primeiro(obj: Record<string, unknown>, nomes: string[]) {
  for (const n of nomes) {
    for (const k of Object.keys(obj)) {
      if (nomeCampo(k) === nomeCampo(n) && obj[k] != null && String(obj[k]).trim()) return obj[k];
    }
  }
  return null;
}

const ROTA_ANTIGA = /\/legado\/([\w-]{20,80})\/?$/;

async function acharPerfil(req: Request, corpo: Record<string, unknown>) {
  const antigo = new URL(req.url).pathname.match(ROTA_ANTIGA);
  if (antigo) {
    const hash = resumoAtalhoAntigo(antigo[1]);
    const { data: conta } = await supabase.from('contas_antigas').select('user_id').eq('atalho_hash', hash).maybeSingle();
    if (!conta) return { erro: resposta(404, { ok: false, erro: 'Endereço não encontrado.' }) };
    const { data: perfil } = await supabase.from('perfis').select('user_id, renda_mensal').eq('user_id', conta.user_id).single();
    return { perfil };
  }
  const token = texto(primeiro(corpo, ['token', 'codigo', 'código']), 100);
  if (!token || !/^[0-9a-f]{48}$/.test(token)) {
    return { erro: resposta(401, { ok: false, erro: 'Código do Camarada inválido. Copie de novo no app.' }) };
  }
  const { data: perfil, error } = await supabase
    .from('perfis')
    .select('user_id, renda_mensal')
    .eq('token_atalho', token)
    .maybeSingle();
  if (error) return { erro: resposta(500, { ok: false, erro: 'Erro ao buscar conta' }) };
  if (!perfil) return { erro: resposta(401, { ok: false, erro: 'Código do Camarada não encontrado. Copie de novo no app.' }) };
  return { perfil };
}

/** Como o pedido chegou (nomes e tipos dos campos, e o valor como veio), sem o código secreto. */
function formatoDo(req: Request, corpo: Record<string, unknown>) {
  const campos: Record<string, string> = {};
  for (const [k, v] of Object.entries(corpo)) {
    campos[k] = k.toLowerCase() === 'token' ? `${typeof v}(${String(v ?? '').length})` : `${typeof v}: ${JSON.stringify(v)?.slice(0, 60)}`;
  }
  return { tipo: req.headers.get('content-type'), legado: ROTA_ANTIGA.test(new URL(req.url).pathname), campos };
}

async function anotar(userId: string | null, status: number, motivo: string | null, formato: unknown) {
  try {
    await supabase.from('tentativas_atalho').insert({ user_id: userId, status, motivo, formato });
    await supabase.from('tentativas_atalho').delete().lt('criado_em', new Date(Date.now() - 14 * 864e5).toISOString());
  } catch (e) {
    console.error('Não anotou a tentativa', e);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta(405, { ok: false, erro: 'Use POST' });

  const corpo = await lerCorpo(req);
  const formato = formatoDo(req, corpo);
  const { perfil, erro } = await acharPerfil(req, corpo);
  if (erro) {
    await anotar(null, erro.status, (await erro.clone().json().catch(() => ({}))).erro ?? null, formato);
    return erro;
  }

  const valorBruto = primeiro(corpo, ['valor', 'amount', 'quantia', 'total']);
  const valor = lerValor(String(valorBruto ?? ''));
  if (!Number.isFinite(valor) || valor === 0 || Math.abs(valor) > 1_000_000) {
    await anotar(perfil!.user_id, 400, 'valor', formato);
    return resposta(400, { ok: false, erro: `Não entendi o valor do gasto: ${String(valorBruto ?? '')}` });
  }

  const userId = perfil!.user_id;
  const estabelecimento = texto(primeiro(corpo, ['estabelecimento', 'local', 'comerciante', 'merchant', 'descricao', 'nome']), 120);
  const cartao = nomeCartao(String(primeiro(corpo, ['cartao', 'cartão', 'card', 'cartao ou passe']) ?? ''));

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
  if (erroGasto) {
    await anotar(userId, 500, erroGasto.message, formato);
    return resposta(500, { ok: false, erro: 'Erro ao salvar compra' });
  }
  await anotar(userId, 200, null, formato);

  // Resumo do mês para a notificação: "hoje ainda dá para gastar R$ X".
  const hoje = diaLocal(new Date(), FUSO);
  const mes = chaveMes(hoje);
  const [ano, m] = mes.split('-').map(Number);
  const inicio = new Date(Date.UTC(ano, m - 1, 1) - 3 * 3600_000).toISOString();
  const fim = new Date(Date.UTC(ano, m, 1) + 3 * 3600_000).toISOString();

  const [{ data: gastos }, { data: rendaMes }, { data: contas }] = await Promise.all([
    supabase.from('gastos').select('valor, data, forma, investimento, tarefa_id').eq('user_id', userId).gte('data', inicio).lt('data', fim),
    supabase.from('rendas_mes').select('valor').eq('user_id', userId).eq('mes', mes).maybeSingle(),
    // Contas a pagar (tarefas abertas com valor): já saem do que dá para gastar.
    supabase.from('tarefas').select('id, titulo, vencimento, valor, concluida_em').eq('user_id', userId)
      .is('concluida_em', null).not('valor', 'is', null),
  ]);
  const renda = Number(rendaMes?.valor ?? perfil!.renda_mensal ?? 0);
  const resumo = resumoMes({ renda, gastos: gastos ?? [], mes, hoje, timeZone: FUSO, compromissos: compromissosDoMes(contas ?? [], mes, hoje) });

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

  // Meta de gastos: avisa aos 80% e aos 100% (uma vez por mês cada).
  let meta = null;
  try {
    meta = await conferirMeta(supabase, userId);
  } catch (e) {
    console.error('Compra salva, mas a meta não foi conferida', e);
  }

  // "sobra" é o que o Atalho do app antigo recebia de volta: quanto ainda resta no mês.
  return resposta(200, { ok: true, forma, meta, valor: formatarReal(valor), sobra: formatarReal(resumo.resta), mensagem: `${titulo} — ${mensagem}` });
});
