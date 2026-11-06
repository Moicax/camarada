// Copia as contas do app antigo (Netlify Blobs, loja "camarada") para o app novo (Supabase).
// No app antigo é SÓ LEITURA: nada lá é gravado nem apagado.
//
// Para cada conta antiga ("conta-<nome>" → u-<id>-dados, u-<id>-acesso, u-<id>-entrada-*):
//  - cria a conta no login novo (se ainda não existe), entrando com o mesmo nome;
//  - guarda a senha antiga (o resumo scrypt dela), que vale na primeira entrada;
//  - guarda o resumo do endereço do Apple Pay, para o Atalho do iPhone continuar funcionando;
//  - troca as tarefas, categorias, cartões e gastos da conta nova pelos do app antigo.
// Rodar de novo atualiza a cópia (o app antigo continua sendo o que vale até a troca).
//
// O log é público (repositório aberto): só mostra contagens, nunca nomes, valores ou textos.
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { emailDeEntrada } from '../web/lib/contas.js';
import { resumoAtalhoAntigo } from '../supabase/functions/_shared/senha-antiga.js';
import { etapaAviso } from '../web/lib/tasks.js';
import { diaLocal, diasEntre } from '../web/lib/dates.js';

const SUPABASE = 'https://api.supabase.com/v1';
const REF = 'pejnliiixdxfmmzozqgw';
const FUSO = 'America/Sao_Paulo';
const tokenSb = process.env.SUPABASE_ACCESS_TOKEN;
const tokenNl = process.env.NETLIFY_AUTH_TOKEN;

async function chamar(url, opcoes) {
  const r = await fetch(url, opcoes);
  const texto = await r.text();
  let dados;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
  if (!r.ok) throw new Error(`${opcoes?.method ?? 'GET'} ${url.replace(/\?.*/, '')} → ${r.status}: ${String(texto).slice(0, 300)}`);
  return dados;
}
const sb = (metodo, caminho, corpo) => chamar(`${SUPABASE}${caminho}`, {
  method: metodo,
  headers: { authorization: `Bearer ${tokenSb}`, 'content-type': 'application/json' },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const sql = (query) => sb('POST', `/projects/${REF}/database/query`, { query });
const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
/** JSON dentro do SQL sem risco de aspas: $j<aleatório>$ ... $j<aleatório>$ */
function jsonLit(obj) {
  const tag = `j${randomBytes(6).toString('hex')}`;
  return `$${tag}$${JSON.stringify(obj)}$${tag}$::jsonb`;
}

// ---------------------------------------------------------------- conversões

const corta = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const ISO_DIA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
// Dia sem hora (app antigo) → meio-dia em Brasília (fica no mesmo dia em qualquer conta de fuso).
const meioDia = (d) => `${d}T12:00:00-03:00`;
const quando = (s, padrao) => (typeof s === 'string' && !Number.isNaN(Date.parse(s)) ? s : padrao);

/** Id novo, sempre o mesmo para o mesmo id antigo (rodar de novo não duplica nada). */
async function uuidDe(...partes) {
  const { createHash } = await import('node:crypto');
  const h = createHash('sha256').update(partes.join(':')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${(8 | (parseInt(h[16], 16) & 3)).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function converter(idAntigo, dados, entradas, agora) {
  const hoje = diaLocal(agora, FUSO);
  const prefs = dados.preferencias ?? {};
  const avisoPadrao = Number.isInteger(prefs.aviso_padrao) ? prefs.aviso_padrao : 7;

  const categorias = [];
  const idCategoria = new Map();
  for (const c of dados.categorias ?? []) {
    if (c.apagado || !corta(c.nome, 40)) continue;
    const id = await uuidDe('cat', idAntigo, c.id);
    idCategoria.set(c.id, { id, aviso: Number.isInteger(c.aviso_dias) ? c.aviso_dias : avisoPadrao });
    categorias.push({ id, nome: corta(c.nome, 40), aviso_dias: Math.min(90, Math.max(0, Number.isInteger(c.aviso_dias) ? c.aviso_dias : 7)) });
  }

  const vivos = (dados.itens ?? []).filter((t) => !t.apagado);
  const idTarefa = new Map();
  for (const t of vivos) idTarefa.set(t.id, await uuidDe('tarefa', idAntigo, t.id));
  const tarefas = vivos.map((t) => {
    const vencimento = ISO_DIA.test(t.data_limite ?? '') ? t.data_limite : null;
    const hora = vencimento && HORA.test(t.hora ?? '') ? t.hora : null;
    const cat = idCategoria.get(t.categoria_id);
    const concluida_em = ISO_DIA.test(t.concluido_em ?? '') ? meioDia(t.concluido_em) : null;
    // Avisos que o app antigo já mandou (dias que já passaram e hoje): não mandar de novo.
    const enviados = [];
    if (vencimento && !concluida_em) {
      const aviso = Number.isInteger(t.aviso_dias) ? t.aviso_dias : cat?.aviso ?? avisoPadrao;
      for (let d = -40; d <= 0; d++) {
        const dia = new Date(Date.parse(`${hoje}T12:00:00Z`) + d * 864e5).toISOString().slice(0, 10);
        const e = etapaAviso({ vencimento, avisos_enviados: enviados }, aviso, dia);
        if (e) enviados.push(e);
      }
      if (hora && (diasEntre(hoje, vencimento) < 0 || (vencimento === hoje && hora <= new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }).format(agora)))) {
        enviados.push('h3', 'h1', 'm10');
      }
    }
    return {
      id: idTarefa.get(t.id),
      titulo: corta(t.titulo, 120) || 'Sem título',
      notas: t.notas ? String(t.notas).slice(0, 2000) : null,
      vencimento,
      hora,
      recorrencia: vencimento && ['semanal', 'mensal', 'anual'].includes(t.recorrencia) ? t.recorrencia : null,
      dia_original: Number.isInteger(t.dia_original) && t.dia_original >= 1 && t.dia_original <= 31 ? t.dia_original : null,
      gerado_de: idTarefa.get(t.gerado_de) ?? null,
      categoria_id: cat?.id ?? null,
      concluida_em,
      avisos_enviados: enviados,
      criado_em: quando(t.criado_em, agora.toISOString()),
    };
  });

  // Gastos: os do app e os do Apple Pay que ainda estavam na caixa de entrada (sem repetir).
  const porId = new Map();
  for (const g of [...(dados.gastos ?? []), ...entradas]) {
    if (!g?.id) continue;
    const atual = porId.get(g.id);
    if (!atual || String(g.atualizado_em ?? '') > String(atual.atualizado_em ?? '')) porId.set(g.id, g);
  }
  const debito = new Set((prefs.debito ?? []).map((c) => corta(c, 60).toLowerCase()));
  const cartoes = new Map();
  const gastos = [];
  for (const g of porId.values()) {
    if (g.apagado || !Number.isInteger(g.valor) || g.valor <= 0) continue;
    const nomeCartao = corta(g.cartao, 60);
    if (nomeCartao && !cartoes.has(nomeCartao.toLowerCase())) {
      cartoes.set(nomeCartao.toLowerCase(), { id: await uuidDe('cartao', idAntigo, nomeCartao.toLowerCase()), nome: nomeCartao, debito: debito.has(nomeCartao.toLowerCase()) });
    }
    gastos.push({
      id: await uuidDe('gasto', idAntigo, g.id),
      valor: (g.valor / 100).toFixed(2),
      estabelecimento: corta(g.descricao, 120) || null,
      cartao_id: nomeCartao ? cartoes.get(nomeCartao.toLowerCase()).id : null,
      data: ISO_DIA.test(g.data ?? '') ? meioDia(g.data) : quando(g.criado_em, agora.toISOString()),
      origem: g.origem === 'applepay' ? 'atalho' : 'manual',
      id_externo: `antigo:${g.id}`,
      forma: g.forma === 'avista' ? 'avista' : 'credito',
      criado_em: quando(g.criado_em, agora.toISOString()),
    });
  }
  // Cartões de débito marcados em Ajustes que ainda não têm compra.
  for (const nome of prefs.debito ?? []) {
    const n = corta(nome, 60);
    if (n && !cartoes.has(n.toLowerCase())) cartoes.set(n.toLowerCase(), { id: await uuidDe('cartao', idAntigo, n.toLowerCase()), nome: n, debito: true });
  }

  return {
    perfil: {
      nome: corta(prefs.apelido && prefs.apelido !== 'Camarada' ? prefs.apelido : '', 60) || null,
      renda_mensal: Number.isInteger(prefs.renda) && prefs.renda > 0 ? (prefs.renda / 100).toFixed(2) : '0',
      horario_aviso: Number.isInteger(prefs.horario) && prefs.horario >= 0 && prefs.horario <= 23 ? prefs.horario : 9,
    },
    categorias, tarefas, cartoes: [...cartoes.values()], gastos,
  };
}

// ---------------------------------------------------------------- Supabase

async function chaveServico() {
  const chaves = await sb('GET', `/projects/${REF}/api-keys?reveal=true`);
  const k = chaves.find((x) => x.name === 'service_role' && x.api_key) ?? chaves.find((x) => x.type === 'secret' && x.api_key);
  if (!k) throw new Error('Não encontrei a chave de serviço do projeto.');
  return k.api_key;
}

async function garantirUsuario(servico, idAntigo, login, nome) {
  const [ja] = await sql(`select user_id from public.contas_antigas where id_antigo = ${lit(idAntigo)}`);
  if (ja) return { userId: ja.user_id, nova: false };
  const email = emailDeEntrada(login);
  const [existente] = await sql(`select id from auth.users where email = ${lit(email)}`);
  if (existente) return { userId: existente.id, nova: false };
  const criado = await chamar(`https://${REF}.supabase.co/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: servico, authorization: `Bearer ${servico}`, 'content-type': 'application/json' },
    // Senha aleatória que ninguém sabe: a pessoa entra com a senha antiga, que passa a valer aqui.
    body: JSON.stringify({ email, password: randomBytes(24).toString('base64url'), email_confirm: true, user_metadata: { nome: nome ?? login } }),
  });
  return { userId: criado.id, nova: true };
}

async function gravarConta(userId, idAntigo, acesso, login, c) {
  const u = lit(userId);
  await sql(`
    begin;
    update public.perfis set
      login = ${lit(login)},
      nome = coalesce(${lit(c.perfil.nome)}, nome, initcap(${lit(login.replace(/-/g, ' '))})),
      renda_mensal = ${c.perfil.renda_mensal},
      horario_aviso = ${c.perfil.horario_aviso},
      dono = ${acesso.dono === true}
    where user_id = ${u};
    insert into public.contas_antigas (user_id, id_antigo, login, senha_hash, atalho_hash)
      values (${u}, ${lit(idAntigo)}, ${lit(login)}, ${lit(acesso.senha ?? null)}, ${lit(acesso.atalho ? resumoAtalhoAntigo(acesso.atalho) : null)})
      on conflict (user_id) do update set login = excluded.login, senha_hash = excluded.senha_hash,
        atalho_hash = excluded.atalho_hash, copiado_em = now();
    delete from public.gastos where user_id = ${u};
    delete from public.tarefas where user_id = ${u};
    delete from public.categorias where user_id = ${u};
    delete from public.cartoes where user_id = ${u};
    insert into public.categorias (id, user_id, nome, aviso_dias)
      select id, ${u}, nome, aviso_dias from jsonb_to_recordset(${jsonLit(c.categorias)}) as x(id uuid, nome text, aviso_dias int);
    insert into public.cartoes (id, user_id, nome, debito)
      select id, ${u}, nome, debito from jsonb_to_recordset(${jsonLit(c.cartoes)}) as x(id uuid, nome text, debito boolean);
    insert into public.tarefas (id, user_id, titulo, notas, vencimento, hora, recorrencia, dia_original, categoria_id, concluida_em, avisos_enviados, criado_em)
      select id, ${u}, titulo, notas, vencimento, hora, recorrencia, dia_original, categoria_id, concluida_em, avisos_enviados, criado_em
      from jsonb_to_recordset(${jsonLit(c.tarefas)}) as x(id uuid, titulo text, notas text, vencimento date, hora time, recorrencia text,
        dia_original smallint, categoria_id uuid, concluida_em timestamptz, avisos_enviados text[], criado_em timestamptz);
    update public.tarefas t set gerado_de = x.gerado_de
      from jsonb_to_recordset(${jsonLit(c.tarefas.filter((t) => t.gerado_de))}) as x(id uuid, gerado_de uuid)
      where t.id = x.id and t.user_id = ${u};
    insert into public.gastos (id, user_id, valor, estabelecimento, cartao_id, data, origem, id_externo, forma, criado_em)
      select id, ${u}, valor, estabelecimento, cartao_id, data, origem, id_externo, forma, criado_em
      from jsonb_to_recordset(${jsonLit(c.gastos)}) as x(id uuid, valor numeric, estabelecimento text, cartao_id uuid,
        data timestamptz, origem text, id_externo text, forma text, criado_em timestamptz);
    commit;`);
  const [conf] = await sql(`select
      (select count(*)::int from public.tarefas where user_id = ${u}) as tarefas,
      (select count(*)::int from public.categorias where user_id = ${u}) as categorias,
      (select count(*)::int from public.gastos where user_id = ${u}) as gastos,
      (select coalesce(sum(valor), 0)::numeric(14,2)::text from public.gastos where user_id = ${u}) as soma`);
  return conf;
}

// ---------------------------------------------------------------- principal

async function principal() {
  if (!tokenSb || !tokenNl) throw new Error('Faltam SUPABASE_ACCESS_TOKEN e NETLIFY_AUTH_TOKEN.');
  const sites = await chamar('https://api.netlify.com/api/v1/sites?filter=all&name=camarada-organizador', { headers: { authorization: `Bearer ${tokenNl}` } });
  const site = sites.find((s) => s.name === 'camarada-organizador');
  const { getStore } = await import('@netlify/blobs');
  const loja = getStore({ name: 'camarada', siteID: site.id, token: tokenNl });
  const ler = (chave) => loja.get(chave, { type: 'json' });
  const servico = await chaveServico();
  const agora = new Date();

  const { blobs } = await loja.list({ prefix: 'conta-' });
  console.log(`Contas no app antigo: ${blobs.length}`);
  let falhas = 0;
  for (const [i, { key }] of blobs.entries()) {
    const rotulo = `conta ${i + 1}`;
    try {
      const login = key.slice('conta-'.length);
      const idAntigo = (await ler(key))?.id;
      if (!/^[a-f0-9]{16}$/.test(idAntigo ?? '')) { console.log(`${rotulo}: índice inválido, pulada`); continue; }
      const [dados, acesso] = await Promise.all([ler(`u-${idAntigo}-dados`), ler(`u-${idAntigo}-acesso`)]);
      if (!dados || !acesso) { console.log(`${rotulo}: sem dados, pulada`); continue; }
      const { blobs: caixa } = await loja.list({ prefix: `u-${idAntigo}-entrada-` });
      const entradas = (await Promise.all(caixa.map((b) => ler(b.key)))).filter(Boolean);

      const c = await converter(idAntigo, dados, entradas, agora);
      const somaAntiga = c.gastos.reduce((s, g) => s + Math.round(Number(g.valor) * 100), 0);
      const { userId, nova } = await garantirUsuario(servico, idAntigo, login, c.perfil.nome);
      const conf = await gravarConta(userId, idAntigo, acesso, login, c);
      const confere = conf.tarefas === c.tarefas.length && conf.categorias === c.categorias.length
        && conf.gastos === c.gastos.length && Math.round(Number(conf.soma) * 100) === somaAntiga;
      console.log(`${rotulo}: ${nova ? 'criada' : 'atualizada'}${acesso.dono ? ' (dono)' : ''} · ${conf.tarefas} tarefas · ${conf.categorias} categorias · ${conf.gastos} gastos (${entradas.length} da caixa do Apple Pay) · senha antiga ${acesso.senha ? 'guardada' : 'ausente'} · Apple Pay ${acesso.atalho ? 'mantido' : 'sem endereço'} · ${confere ? 'conferido ✓' : 'NÃO CONFERE ✗'}`);
      if (!confere) falhas++;
    } catch (e) {
      falhas++;
      console.error(`${rotulo}: falhou — ${e.message.replace(/'[^']*'/g, "'…'")}`);
    }
  }
  if (falhas) throw new Error(`${falhas} conta(s) com problema.`);
  console.log('Tudo copiado e conferido. Nada foi alterado no app antigo.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  principal().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}
