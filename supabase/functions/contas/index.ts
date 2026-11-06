// Contas do Camarada (como no app antigo): entrar com o nome, criar conta pelo link de convite,
// e a conta dono vê as pessoas, troca o link e gera senha provisória para quem esqueceu.
//
// POST /functions/v1/contas  { "acao": "...", ... }
//   senha-antiga  { nome, senha }            → na 1ª entrada de quem veio do app antigo, confere a senha
//                                              antiga e a transforma na senha do login novo
//   criar         { convite, nome, senha }   → cria a conta (só com o link de convite)
//   convite-ok    { convite }                → o link ainda vale?
//   pessoas                                  → (dono) lista de contas
//   convite / novo-convite                   → (dono) link atual / troca o link
//   nova-senha    { user_id }                → (dono) senha provisória para quem esqueceu
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { timingSafeEqual, randomBytes, randomInt } from 'node:crypto';
import { conferirSenhaAntiga } from '../_shared/senha-antiga.js';
import { nomeDeEntrada, emailDeEntrada, senhaProvisoria } from '../_shared/contas.js';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const resposta = (status: number, corpo: Record<string, unknown>) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
const erro = (status: number, mensagem: string) => resposta(status, { ok: false, erro: mensagem });
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SENHA_MINIMA = 6;

function novoCodigo() {
  return Array.from(randomBytes(18), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function quemChama(req: Request) {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data } = await supabase.auth.getUser(jwt);
  if (!data.user) return null;
  const { data: p } = await supabase.from('perfis').select('user_id, dono').eq('user_id', data.user.id).maybeSingle();
  return p;
}

async function conviteAtual(trocar = false) {
  const { data } = await supabase.from('convite').select('codigo').eq('id', 1).maybeSingle();
  if (data && !trocar) return data.codigo as string;
  const codigo = novoCodigo();
  const { error } = await supabase.from('convite').upsert({ id: 1, codigo, criado_em: new Date().toISOString() });
  if (error) throw error;
  return codigo;
}

async function conviteValido(codigo: unknown) {
  if (typeof codigo !== 'string' || !/^[0-9a-f]{36}$/.test(codigo)) return false;
  const { data } = await supabase.from('convite').select('codigo').eq('id', 1).maybeSingle();
  if (!data) return false;
  const a = new TextEncoder().encode(codigo);
  const b = new TextEncoder().encode(data.codigo);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function loginOcupado(login: string) {
  const [{ data: p }, { data: a }] = await Promise.all([
    supabase.from('perfis').select('user_id').eq('login', login).maybeSingle(),
    supabase.from('contas_antigas').select('user_id').eq('login', login).maybeSingle(),
  ]);
  return Boolean(p || a);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return erro(405, 'Use POST');
  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return erro(400, 'Corpo precisa ser JSON'); }
  const acao = String(corpo.acao ?? '');

  try {
    // ------------------------------------------------ sem login
    if (acao === 'senha-antiga') {
      const login = nomeDeEntrada(corpo.nome);
      const senha = String(corpo.senha ?? '');
      const { data: antiga } = login
        ? await supabase.from('contas_antigas').select('user_id, senha_hash').eq('login', login).maybeSingle()
        : { data: null };
      if (!antiga?.senha_hash || senha.length < SENHA_MINIMA || !(await conferirSenhaAntiga(senha, antiga.senha_hash))) {
        await pausa(1000); // como no app antigo: 1 s de pausa a cada erro
        return erro(401, 'Nome ou senha incorretos.');
      }
      const { error } = await supabase.auth.admin.updateUserById(antiga.user_id, { password: senha });
      if (error) throw error;
      await supabase.from('contas_antigas').update({ senha_hash: null }).eq('user_id', antiga.user_id);
      return resposta(200, { ok: true, email: emailDeEntrada(login) });
    }

    if (acao === 'convite-ok') return resposta(200, { ok: await conviteValido(corpo.convite) });

    if (acao === 'criar') {
      if (!(await conviteValido(corpo.convite))) {
        await pausa(1000);
        return erro(403, 'Este link de convite não vale mais. Peça um novo para quem te convidou.');
      }
      const nome = String(corpo.nome ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
      const login = nomeDeEntrada(nome);
      const senha = String(corpo.senha ?? '');
      if (login.length < 2) return erro(400, 'Escreva o seu nome.');
      if (senha.length < SENHA_MINIMA) return erro(400, 'A senha precisa ter pelo menos 6 caracteres.');
      if (await loginOcupado(login)) return erro(409, 'Já existe uma conta com este nome. Use outro (por exemplo, com o sobrenome).');
      const { data, error } = await supabase.auth.admin.createUser({
        email: emailDeEntrada(login), password: senha, email_confirm: true, user_metadata: { nome },
      });
      if (error) {
        if (/already/i.test(error.message)) return erro(409, 'Já existe uma conta com este nome.');
        throw error;
      }
      const { error: e2 } = await supabase.from('perfis').update({ login, nome: nome.split(' ')[0] }).eq('user_id', data.user.id);
      if (e2) throw e2;
      return resposta(200, { ok: true, email: emailDeEntrada(login) });
    }

    // ------------------------------------------------ só a conta dono
    const eu = await quemChama(req);
    if (!eu) return erro(401, 'Entre de novo no app.');
    if (!eu.dono) return erro(403, 'Só quem cuida do app pode fazer isso.');

    if (acao === 'pessoas') {
      const { data, error } = await supabase.from('perfis')
        .select('user_id, nome, login, dono, criado_em').order('criado_em');
      if (error) throw error;
      return resposta(200, { ok: true, pessoas: data });
    }
    if (acao === 'convite' || acao === 'novo-convite') {
      return resposta(200, { ok: true, codigo: await conviteAtual(acao === 'novo-convite') });
    }
    if (acao === 'nova-senha') {
      const alvo = String(corpo.user_id ?? '');
      const { data: p } = await supabase.from('perfis').select('user_id').eq('user_id', alvo).maybeSingle();
      if (!p) return erro(404, 'Conta não encontrada.');
      const senha = senhaProvisoria((n: number) => randomInt(n));
      const { error } = await supabase.auth.admin.updateUserById(alvo, { password: senha });
      if (error) throw error;
      await supabase.from('contas_antigas').update({ senha_hash: null }).eq('user_id', alvo);
      return resposta(200, { ok: true, senha });
    }
    return erro(400, 'Ação desconhecida');
  } catch (e) {
    console.error('contas', acao, e);
    return erro(500, 'Algo deu errado. Tente de novo.');
  }
});
