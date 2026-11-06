// Acesso aos dados. Duas versões com a mesma interface:
//  - Supabase (uso real, cada pessoa com sua conta)
//  - Demonstração (dados de exemplo no navegador, para testar sem servidor)
import { CONFIG } from './config.js';
import { diaLocal, somarDias } from './lib/dates.js';
import { emailDeEntrada, nomeDeEntrada } from './lib/contas.js';

export const MODO_DEMO = !CONFIG.supabaseUrl;

function intervaloDoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return { inicio: new Date(a, m - 1, 1).toISOString(), fim: new Date(a, m, 1).toISOString() };
}

const erroAmigavel = (e) => {
  const msg = e?.message || String(e);
  if (/Invalid login credentials/i.test(msg)) return 'Nome ou senha incorretos.';
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

  // Função "contas" do servidor. Devolve { ok, erro? } mesmo quando a resposta é um erro (4xx).
  async function contas(corpo) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${CONFIG.supabaseUrl}/functions/v1/contas`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: CONFIG.supabaseAnonKey,
        authorization: `Bearer ${session?.access_token ?? CONFIG.supabaseAnonKey}`,
      },
      body: JSON.stringify(corpo),
    });
    try { return await r.json(); } catch { return { ok: false, erro: 'O servidor não respondeu. Tente de novo.' }; }
  }
  const exigir = (r) => { if (!r.ok) throw new Error(r.erro || 'Algo deu errado.'); return r; };

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
    /** Entra com o nome (ou e-mail) e a senha. Quem veio do app antigo entra com a senha de antes. */
    async entrar(nomeOuEmail, senha) {
      const email = emailDeEntrada(nomeOuEmail);
      const primeira = await sb.auth.signInWithPassword({ email, password: senha });
      if (!primeira.error) return;
      if (!/Invalid login credentials/i.test(primeira.error.message) || nomeOuEmail.includes('@')) ok(primeira);
      // Primeira entrada depois da mudança: o servidor confere a senha do app antigo e a passa para cá.
      const r = await contas({ acao: 'senha-antiga', nome: nomeOuEmail, senha });
      if (!r.ok) throw new Error('Nome ou senha incorretos.');
      ok(await sb.auth.signInWithPassword({ email, password: senha }));
    },
    /** Cria a conta pelo link de convite e já entra. */
    async criarConta(convite, nome, senha) {
      const r = await contas({ acao: 'criar', convite, nome, senha });
      if (!r.ok) throw new Error(r.erro);
      ok(await sb.auth.signInWithPassword({ email: r.email, password: senha }));
    },
    async conviteValido(convite) {
      return (await contas({ acao: 'convite-ok', convite })).ok;
    },
    async trocarSenha(senha, atual) {
      if (atual !== undefined) {
        const { data: { user } } = await sb.auth.getUser();
        const conferida = await sb.auth.signInWithPassword({ email: user.email, password: atual });
        if (conferida.error) throw new Error('A senha atual não confere.');
      }
      ok(await sb.auth.updateUser({ password: senha }));
    },
    /** Só a conta dono: pessoas, link de convite e senha provisória. */
    async pessoas() { return exigir(await contas({ acao: 'pessoas' })).pessoas; },
    async convite(trocar = false) { return exigir(await contas({ acao: trocar ? 'novo-convite' : 'convite' })).codigo; },
    async novaSenhaPara(userId) { return exigir(await contas({ acao: 'nova-senha', user_id: userId })).senha; },
    async sair() {
      await sb.auth.signOut();
    },

    async perfil() {
      return ok(await sb.from('perfis').select('nome, login, dono, renda_mensal, token_atalho, horario_aviso, meta_gasto, meta_investimento, recompensa_texto, recompensa_pontos, bom_dia, criado_em').single());
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
        .select('id, titulo, notas, vencimento, hora, recorrencia, dia_original, gerado_de, categoria_id, concluida_em, avisos_enviados')
        .order('vencimento'));
    },
    async salvarTarefa({ id, ...campos }) {
      if (id) ok(await sb.from('tarefas').update(campos).eq('id', id));
      else ok(await sb.from('tarefas').insert(campos));
    },
    async apagarTarefa(id) {
      ok(await sb.from('tarefas').delete().eq('id', id));
    },
    /** Desfazer a conclusão de uma tarefa que repete: apaga a próxima que ela gerou. */
    async apagarGeradas(idOrigem) {
      ok(await sb.from('tarefas').delete().eq('gerado_de', idOrigem).is('concluida_em', null));
    },

    async gastosDoMes(mes) {
      const { inicio, fim } = intervaloDoMes(mes);
      const linhas = ok(await sb.from('gastos')
        .select('id, valor, estabelecimento, data, origem, forma, investimento, cartoes(nome)')
        .gte('data', inicio).lt('data', fim)
        .order('data', { ascending: false }));
      return linhas.map(({ cartoes, ...g }) => ({ ...g, valor: Number(g.valor), cartao: cartoes?.nome ?? null }));
    },
    /** Lançamentos desde um dia (AAAA-MM-DD, meia-noite daqui): base dos pontos e da sequência. */
    async gastosDesde(dia) {
      const [a, m, d] = dia.split('-').map(Number);
      const linhas = ok(await sb.from('gastos')
        .select('id, valor, estabelecimento, data, origem, forma, investimento, cartoes(nome)')
        .gte('data', new Date(a, m - 1, d).toISOString())
        .order('data', { ascending: false }));
      return linhas.map(({ cartoes, ...g }) => ({ ...g, valor: Number(g.valor), cartao: cartoes?.nome ?? null }));
    },
    /** Renda específica de alguns meses (quando difere da renda padrão): { 'AAAA-MM': valor }. */
    async rendasDe(meses) {
      const linhas = ok(await sb.from('rendas_mes').select('mes, valor').in('mes', meses));
      return Object.fromEntries(linhas.map((r) => [r.mes, Number(r.valor)]));
    },
    async cartoes() {
      return ok(await sb.from('cartoes').select('id, nome').order('nome')).map((c) => c.nome);
    },
    async salvarGasto({ id, valor, estabelecimento, cartao, forma, investimento = false, data }) {
      const campos = { valor, estabelecimento, cartao_id: await idCartao(cartao), forma, investimento, data };
      if (id) ok(await sb.from('gastos').update(campos).eq('id', id));
      else ok(await sb.from('gastos').insert({ ...campos, origem: 'manual' }));
    },
    async apagarGasto(id) {
      ok(await sb.from('gastos').delete().eq('id', id));
    },
    /** Desfazer: põe de volta um lançamento apagado, igual ao que era (inclusive se veio do Apple Pay). */
    async restaurarGasto(g) {
      ok(await sb.from('gastos').insert({
        valor: g.valor, estabelecimento: g.estabelecimento, cartao_id: await idCartao(g.cartao),
        forma: g.forma, investimento: Boolean(g.investimento), data: g.data, origem: g.origem || 'manual',
      }));
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

    /** Cartão de débito: compras do Apple Pay com ele já feitas passam a contar como à vista. */
    async salvarCartao(id, debito) {
      ok(await sb.from('cartoes').update({ debito }).eq('id', id));
      ok(await sb.from('gastos').update({ forma: debito ? 'avista' : 'credito' }).eq('cartao_id', id).eq('origem', 'atalho'));
    },
    /** Confere a meta de gastos no servidor (ele avisa aos 80% e aos 100%, uma vez por mês cada). */
    async bomDia() {
      const { data, error } = await sb.functions.invoke('notificar', { body: { tipo: 'bomdia' } });
      if (error) throw new Error('Não foi possível montar o bom dia agora.');
      return data;
    },
    async conferirMeta() {
      const { data, error } = await sb.functions.invoke('notificar', { body: { tipo: 'meta' } });
      if (error) throw error;
      return data;
    },
    async testarNotificacao() {
      const { data, error } = await sb.functions.invoke('notificar', { body: { tipo: 'teste' } });
      if (error) throw new Error('Não foi possível enviar o teste agora.');
      return data?.enviados ?? 0;
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
  const CHAVE = 'camarada-demo-v4';
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
      perfil: { nome: 'Você', login: 'voce', dono: true, renda_mensal: 3500, token_atalho: 'demo'.padEnd(48, '0'), horario_aviso: 9, meta_gasto: 1000, meta_investimento: 500, recompensa_texto: 'Pizza no sábado', recompensa_pontos: 100, bom_dia: true, criado_em: quando(-20, '09:00') },
      categorias: [
        { id: cat.contas, nome: 'Contas', aviso_dias: 5 },
        { id: cat.docs, nome: 'Documentos', aviso_dias: 15 },
        { id: cat.geral, nome: 'Geral', aviso_dias: 3 },
      ],
      tarefas: [
        { id: novoId(), titulo: 'Pagar conta de luz', vencimento: somarDias(hoje, 1), hora: '18:00', categoria_id: cat.contas },
        { id: novoId(), titulo: 'Aluguel', vencimento: somarDias(hoje, 3), categoria_id: cat.contas, recorrencia: 'mensal', dia_original: Number(somarDias(hoje, 3).slice(8, 10)) },
        { id: novoId(), titulo: 'Organizar o armário', vencimento: null, categoria_id: cat.geral },
        { id: novoId(), titulo: 'Pagar academia', vencimento: somarDias(hoje, -1), categoria_id: cat.contas, concluida_em: quando(-1, '19:00') },
        { id: novoId(), titulo: 'Marcar dentista', vencimento: null, categoria_id: cat.geral, concluida_em: quando(0, '08:30') },
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
        { valor: 450, estabelecimento: 'Aluguel (parte)', cartao: null, data: quando(-3, '09:00'), origem: 'manual', forma: 'avista' },
        { valor: 18, estabelecimento: 'Feira (Pix)', cartao: null, data: quando(-1, '10:15'), origem: 'manual', forma: 'avista' },
        { valor: 200, estabelecimento: 'Tesouro Selic', cartao: null, data: quando(-2, '09:30'), origem: 'manual', forma: 'avista', investimento: true },
        { valor: 89.9, estabelecimento: 'Restaurante', cartao: 'Itaú Click', data: quando(-3, '21:30'), origem: 'atalho' },
      ].map((g) => ({ id: novoId(), forma: 'credito', ...g })),
      debito: {},
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
    async entrar(nome) {
      await espera();
      db.usuario = { id: 'demo', email: emailDeEntrada(nome) };
      db.perfil.login = nomeDeEntrada(nome);
      salvar();
      ouvinte('SIGNED_IN', db.usuario);
    },
    async criarConta(_convite, nome) {
      await espera();
      db.perfil.nome = nome.split(' ')[0] || 'Você';
      db.perfil.login = nomeDeEntrada(nome);
      db.usuario = { id: 'demo', email: emailDeEntrada(nome) };
      salvar();
      ouvinte('SIGNED_IN', db.usuario);
    },
    async conviteValido() { return true; },
    async trocarSenha() { await espera(); },
    async pessoas() { return [{ user_id: 'demo', nome: db.perfil.nome, login: db.perfil.login || 'voce', dono: true, criado_em: db.perfil.criado_em }]; },
    async convite() { return 'd'.repeat(36); },
    async novaSenhaPara() { return 'abcd-2345'; },
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
    async apagarGeradas(idOrigem) { db.tarefas = db.tarefas.filter((t) => !(t.gerado_de === idOrigem && !t.concluida_em)); salvar(); },

    async gastosDoMes(mes) {
      await espera();
      const { inicio, fim } = intervaloDoMes(mes);
      return copia(db.gastos.filter((g) => g.data >= inicio && g.data < fim))
        .sort((a, b) => b.data.localeCompare(a.data));
    },
    async gastosDesde(dia) {
      const [a, m, d] = dia.split('-').map(Number);
      const inicio = new Date(a, m - 1, d).toISOString();
      return copia(db.gastos.filter((g) => g.data >= inicio));
    },
    async rendasDe(meses) {
      return Object.fromEntries(meses.filter((m) => db.rendas[m] !== undefined).map((m) => [m, db.rendas[m]]));
    },
    async bomDia() { return null; },
    async cartoes() {
      db.debito ??= {};
      return [...new Set(db.gastos.map((g) => g.cartao).filter(Boolean))].sort()
        .map((nome) => ({ id: nome, nome, debito: Boolean(db.debito[nome]) }));
    },
    async salvarCartao(nome, debito) {
      db.debito ??= {};
      db.debito[nome] = debito;
      db.gastos.forEach((g) => { if (g.cartao === nome && g.origem === 'atalho') g.forma = debito ? 'avista' : 'credito'; });
      salvar();
    },
    async conferirMeta() { return null; },
    async testarNotificacao() {
      const reg = await navigator.serviceWorker?.ready;
      if (!reg || typeof Notification === 'undefined' || Notification.permission !== 'granted') return 0;
      await reg.showNotification('Notificações funcionando', { body: 'É assim que os avisos do Camarada vão chegar.' });
      return 1;
    },
    async salvarGasto(g) {
      if (g.id) Object.assign(db.gastos.find((x) => x.id === g.id), g);
      else db.gastos.push({ ...g, id: novoId(), origem: 'manual' });
      salvar();
    },
    async apagarGasto(id) { db.gastos = db.gastos.filter((g) => g.id !== id); salvar(); },
    async restaurarGasto(g) {
      const { dia, tipo, ...campos } = g;
      db.gastos.push({ ...campos, id: novoId() });
      salvar();
    },
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
