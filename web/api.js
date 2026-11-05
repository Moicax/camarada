// Acesso aos dados. Duas versões com a mesma interface:
//  - Supabase (uso real, cada pessoa com sua conta)
//  - Demonstração (dados de exemplo no navegador, para testar sem servidor)
import { CONFIG } from './config.js';
import { diaLocal, somarDias } from './lib/dates.js';

export const MODO_DEMO = !CONFIG.supabaseUrl;

function intervaloDoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return { inicio: new Date(a, m - 1, 1).toISOString(), fim: new Date(a, m, 1).toISOString() };
}

const erroAmigavel = (e) => {
  const msg = e?.message || String(e);
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(msg)) return 'Confirme seu e-mail pelo link que enviamos.';
  if (/already registered/i.test(msg)) return 'Já existe uma conta com este e-mail.';
  if (/Password should be at least/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/rate limit/i.test(msg)) return 'Muitas tentativas. Espere um pouco e tente de novo.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Sem conexão com a internet.';
  return msg;
};

// ---------------------------------------------------------------- Supabase

async function criarApiSupabase() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
  const ok = ({ data, error }) => {
    if (error) throw new Error(erroAmigavel(error));
    return data;
  };

  async function idCartao(nome) {
    if (!nome) return null;
    const existente = ok(await sb.from('cartoes').select('id').eq('nome', nome).maybeSingle());
    if (existente) return existente.id;
    return ok(await sb.from('cartoes').insert({ nome }).select('id').single()).id;
  }

  return {
    demo: false,
    urlRegistrarCompra: `${CONFIG.supabaseUrl}/functions/v1/registrar-compra`,

    async usuario() {
      const { data } = await sb.auth.getSession();
      return data.session?.user ?? null;
    },
    aoMudarSessao(cb) {
      // O Supabase avisa as mudanças de login enquanto ainda está ocupado com elas.
      // Se a resposta chamar o Supabase na hora, os dois esperam um pelo outro para sempre
      // (o app ficava preso em "Carregando…" ao reabrir já logado). Por isso, responde depois.
      sb.auth.onAuthStateChange((evento, sessao) => {
        setTimeout(() => cb(evento, sessao?.user ?? null), 0);
      });
    },
    async entrar(email, senha) {
      ok(await sb.auth.signInWithPassword({ email, password: senha }));
    },
    async cadastrar(nome, email, senha) {
      const data = ok(await sb.auth.signUp({
        email, password: senha,
        options: { data: { nome }, emailRedirectTo: location.origin },
      }));
      return { precisaConfirmar: !data.session };
    },
    async recuperarSenha(email) {
      ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin }));
    },
    async trocarSenha(senha) {
      ok(await sb.auth.updateUser({ password: senha }));
    },
    async sair() {
      await sb.auth.signOut();
    },

    async perfil() {
      return ok(await sb.from('perfis').select('nome, renda_mensal, token_atalho').single());
    },
    async salvarPerfil(campos) {
      const { data: { user } } = await sb.auth.getUser();
      ok(await sb.from('perfis').update(campos).eq('user_id', user.id));
    },
    async novoToken() {
      return ok(await sb.rpc('novo_token_atalho'));
    },

    async categorias() {
      return ok(await sb.from('categorias').select('id, nome, aviso_dias').order('nome'));
    },
    async salvarCategoria({ id, nome, aviso_dias }) {
      if (id) ok(await sb.from('categorias').update({ nome, aviso_dias }).eq('id', id));
      else ok(await sb.from('categorias').insert({ nome, aviso_dias }));
    },
    async apagarCategoria(id) {
      ok(await sb.from('categorias').delete().eq('id', id));
    },

    async tarefas() {
      return ok(await sb.from('tarefas')
        .select('id, titulo, notas, vencimento, categoria_id, concluida_em, avisos_enviados')
        .order('vencimento'));
    },
    async salvarTarefa({ id, ...campos }) {
      if (id) ok(await sb.from('tarefas').update(campos).eq('id', id));
      else ok(await sb.from('tarefas').insert(campos));
    },
    async apagarTarefa(id) {
      ok(await sb.from('tarefas').delete().eq('id', id));
    },

    async gastosDoMes(mes) {
      const { inicio, fim } = intervaloDoMes(mes);
      const linhas = ok(await sb.from('gastos')
        .select('id, valor, estabelecimento, data, origem, cartoes(nome)')
        .gte('data', inicio).lt('data', fim)
        .order('data', { ascending: false }));
      return linhas.map(({ cartoes, ...g }) => ({ ...g, valor: Number(g.valor), cartao: cartoes?.nome ?? null }));
    },
    async cartoes() {
      return ok(await sb.from('cartoes').select('id, nome').order('nome')).map((c) => c.nome);
    },
    async salvarGasto({ id, valor, estabelecimento, cartao, data }) {
      const campos = { valor, estabelecimento, cartao_id: await idCartao(cartao), data };
      if (id) ok(await sb.from('gastos').update(campos).eq('id', id));
      else ok(await sb.from('gastos').insert({ ...campos, origem: 'manual' }));
    },
    async apagarGasto(id) {
      ok(await sb.from('gastos').delete().eq('id', id));
    },
    async temComprasAutomaticas() {
      const linhas = ok(await sb.from('gastos').select('id').eq('origem', 'atalho').limit(1));
      return linhas.length > 0;
    },

    async rendaDoMes(mes) {
      return ok(await sb.from('rendas_mes').select('valor').eq('mes', mes).maybeSingle())?.valor ?? null;
    },
    async salvarRendaDoMes(mes, valor) {
      if (valor === null) ok(await sb.from('rendas_mes').delete().eq('mes', mes));
      else ok(await sb.from('rendas_mes').upsert({ mes, valor }, { onConflict: 'user_id,mes' }));
    },

    async salvarInscricaoPush(inscricao) {
      const { endpoint, keys } = inscricao.toJSON();
      ok(await sb.from('inscricoes_push').upsert(
        { endpoint, p256dh: keys.p256dh, auth: keys.auth },
        { onConflict: 'endpoint' },
      ));
    },
  };
}

// ---------------------------------------------------------------- Demonstração

function criarApiDemo() {
  const CHAVE = 'camarada-demo-v1';
  const novoId = () => Math.random().toString(36).slice(2, 10);
  const hoje = diaLocal();
  const quando = (dias, hora) => {
    const d = new Date(`${somarDias(hoje, dias)}T${hora}:00`);
    return d.toISOString();
  };

  function exemplo() {
    const cat = { contas: novoId(), docs: novoId(), geral: novoId() };
    return {
      usuario: null,
      perfil: { nome: 'Você', renda_mensal: 3500, token_atalho: 'demo'.padEnd(48, '0') },
      categorias: [
        { id: cat.contas, nome: 'Contas', aviso_dias: 5 },
        { id: cat.docs, nome: 'Documentos', aviso_dias: 15 },
        { id: cat.geral, nome: 'Geral', aviso_dias: 3 },
      ],
      tarefas: [
        { id: novoId(), titulo: 'Pagar conta de luz', vencimento: somarDias(hoje, 1), categoria_id: cat.contas },
        { id: novoId(), titulo: 'Fatura do cartão', vencimento: somarDias(hoje, 4), categoria_id: cat.contas },
        { id: novoId(), titulo: 'Internet', vencimento: somarDias(hoje, -1), categoria_id: cat.contas },
        { id: novoId(), titulo: 'Renovar CNH', vencimento: somarDias(hoje, 40), categoria_id: cat.docs },
        { id: novoId(), titulo: 'Levar o carro na revisão', vencimento: somarDias(hoje, 12), categoria_id: cat.geral },
        { id: novoId(), titulo: 'IPVA', vencimento: somarDias(hoje, -6), categoria_id: cat.contas, concluida_em: quando(-7, '10:00') },
      ].map((t) => ({ notas: '', concluida_em: null, avisos_enviados: [], ...t })),
      gastos: [
        { valor: 23.9, estabelecimento: 'Padaria Real', cartao: 'Nubank', data: quando(0, '08:12'), origem: 'atalho' },
        { valor: 61.4, estabelecimento: 'Posto Shell', cartao: 'Itaú Click', data: quando(0, '12:40'), origem: 'atalho' },
        { valor: 189.32, estabelecimento: 'Supermercado Dia', cartao: 'Nubank', data: quando(-1, '19:05'), origem: 'atalho' },
        { valor: 34.5, estabelecimento: 'Farmácia', cartao: 'Nubank', data: quando(-2, '17:20'), origem: 'manual' },
        { valor: 450, estabelecimento: 'Aluguel (parte)', cartao: null, data: quando(-3, '09:00'), origem: 'manual' },
        { valor: 89.9, estabelecimento: 'Restaurante', cartao: 'Itaú Click', data: quando(-3, '21:30'), origem: 'atalho' },
      ].map((g) => ({ id: novoId(), ...g })),
      rendas: {},
      automaticas: false,
    };
  }

  let db;
  try { db = JSON.parse(localStorage.getItem(CHAVE)); } catch { db = null; }
  if (!db) db = exemplo();
  const salvar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(db)); } catch { /* sem armazenamento */ } };
  let ouvinte = () => {};
  const espera = () => new Promise((r) => setTimeout(r, 120));
  const copia = (x) => structuredClone(x);

  return {
    demo: true,
    urlRegistrarCompra: 'https://SEU-PROJETO.supabase.co/functions/v1/registrar-compra',

    async usuario() { return db.usuario; },
    aoMudarSessao(cb) { ouvinte = cb; },
    async entrar(email) {
      await espera();
      db.usuario = { id: 'demo', email };
      salvar();
      ouvinte('SIGNED_IN', db.usuario);
    },
    async cadastrar(nome, email) {
      await espera();
      db.perfil.nome = nome || 'Você';
      db.usuario = { id: 'demo', email };
      salvar();
      ouvinte('SIGNED_IN', db.usuario);
      return { precisaConfirmar: false };
    },
    async recuperarSenha() { await espera(); },
    async trocarSenha() { await espera(); },
    async sair() {
      db = exemplo();
      salvar();
      ouvinte('SIGNED_OUT', null);
    },

    async perfil() { return copia(db.perfil); },
    async salvarPerfil(campos) { Object.assign(db.perfil, campos); salvar(); },
    async novoToken() { db.perfil.token_atalho = novoId().padEnd(48, '0'); salvar(); return db.perfil.token_atalho; },

    async categorias() { return copia(db.categorias).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')); },
    async salvarCategoria(c) {
      if (c.id) Object.assign(db.categorias.find((x) => x.id === c.id), c);
      else db.categorias.push({ ...c, id: novoId() });
      salvar();
    },
    async apagarCategoria(id) {
      db.categorias = db.categorias.filter((c) => c.id !== id);
      db.tarefas.forEach((t) => { if (t.categoria_id === id) t.categoria_id = null; });
      salvar();
    },

    async tarefas() { await espera(); return copia(db.tarefas); },
    async salvarTarefa(t) {
      if (t.id) Object.assign(db.tarefas.find((x) => x.id === t.id), t);
      else db.tarefas.push({ notas: '', concluida_em: null, avisos_enviados: [], ...t, id: novoId() });
      salvar();
    },
    async apagarTarefa(id) { db.tarefas = db.tarefas.filter((t) => t.id !== id); salvar(); },

    async gastosDoMes(mes) {
      await espera();
      const { inicio, fim } = intervaloDoMes(mes);
      return copia(db.gastos.filter((g) => g.data >= inicio && g.data < fim))
        .sort((a, b) => b.data.localeCompare(a.data));
    },
    async cartoes() { return [...new Set(db.gastos.map((g) => g.cartao).filter(Boolean))].sort(); },
    async salvarGasto(g) {
      if (g.id) Object.assign(db.gastos.find((x) => x.id === g.id), g);
      else db.gastos.push({ ...g, id: novoId(), origem: 'manual' });
      salvar();
    },
    async apagarGasto(id) { db.gastos = db.gastos.filter((g) => g.id !== id); salvar(); },
    async temComprasAutomaticas() { return db.gastos.some((g) => g.origem === 'atalho'); },

    async rendaDoMes(mes) { return db.rendas[mes] ?? null; },
    async salvarRendaDoMes(mes, valor) {
      if (valor === null) delete db.rendas[mes];
      else db.rendas[mes] = valor;
      salvar();
    },

    async salvarInscricaoPush() {},
  };
}

export const api = MODO_DEMO ? criarApiDemo() : await criarApiSupabase();
