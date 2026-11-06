// Avisos de tarefas. Três modos (campo "tipo" no corpo):
//  - "diario"    (agendado de hora em hora): para quem escolheu receber os avisos nesta hora,
//                avisa quando a tarefa entra em "Vencendo", na véspera, no dia e no dia seguinte.
//                Também atualiza o número no ícone do app.
//  - "lembretes" (agendado de minuto em minuto, só quando há tarefa com horário chegando):
//                avisa 3 horas, 1 hora e 10 minutos antes do horário da tarefa.
//  - "teste"     (botão "Testar notificação" no app): manda um aviso de teste para a própria pessoa.
//  - "meta"      (o app chama depois de lançar algo): confere a meta de gastos da própria pessoa e
//                avisa aos 80% e aos 100%. O "diario" também confere a meta de todos, como garantia.
//  - "bomdia"    (botão "Ver o bom dia" no app): manda agora o bom dia da própria pessoa.
//                O bom dia de verdade sai no "diario", na hora escolhida, antes dos outros avisos.
//
// Publicar com: supabase functions deploy notificar --no-verify-jwt
// "diario" e "lembretes" exigem o cabeçalho x-cron-secret (variável CRON_SECRET);
// "teste", "meta" e "bomdia" exigem o login da pessoa (Authorization: Bearer <token do app>).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { somarDias } from '../_shared/dates.js';
import {
  classificar, etapaAviso, textoAviso, etapaLembrete, textoLembrete, AVISO_PADRAO,
} from '../_shared/tasks.js';
import { enviarPush } from '../_shared/push.ts';
import { conferirMeta } from '../_shared/meta.ts';
import { bomDia, mensagemDoDia } from '../_shared/bomdia.ts';

const FUSO = 'America/Sao_Paulo';
const SEGREDO = Deno.env.get('CRON_SECRET');

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...CORS } });

type Tarefa = {
  id: string;
  user_id: string;
  titulo: string;
  vencimento: string | null;
  hora: string | null;
  concluida_em: string | null;
  avisos_enviados: string[];
  categorias: { aviso_dias: number } | null;
};
const CAMPOS = 'id, user_id, titulo, vencimento, hora, concluida_em, avisos_enviados, categorias(aviso_dias)';

/** Data, hora e minuto de agora em Brasília. */
function agora() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  const hora = Number(p.hour);
  return { hoje: `${p.year}-${p.month}-${p.day}`, hora, minutos: hora * 60 + Number(p.minute) };
}

async function marcar(t: Tarefa, etapa: string) {
  t.avisos_enviados = [...(t.avisos_enviados ?? []), etapa];
  await supabase.from('tarefas').update({ avisos_enviados: t.avisos_enviados }).eq('id', t.id);
}

async function buscar(filtro: (q: ReturnType<typeof consulta>) => ReturnType<typeof consulta>) {
  const tarefas: Tarefa[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(consulta()).order('id').range(de, de + 999);
    if (error) throw error;
    tarefas.push(...(data as unknown as Tarefa[]));
    if (!data || data.length < 1000) break;
  }
  return tarefas;
}
const consulta = () => supabase.from('tarefas').select(CAMPOS).is('concluida_em', null);

async function diario() {
  const { hoje, hora } = agora();
  const { data: perfis, error } = await supabase.from('perfis').select('user_id').eq('horario_aviso', hora);
  if (error) throw error;
  const pessoas = (perfis ?? []).map((p) => p.user_id);
  if (!pessoas.length) return { hoje, hora, pessoas: 0, enviados: 0 };

  const tarefas = await buscar((q) => q.in('user_id', pessoas).lte('vencimento', somarDias(hoje, 90)));
  const porPessoa = new Map<string, Tarefa[]>();
  for (const t of tarefas) porPessoa.set(t.user_id, [...(porPessoa.get(t.user_id) ?? []), t]);

  let enviados = 0;
  for (const [userId, lista] of porPessoa) {
    const aviso = (t: Tarefa) => t.categorias?.aviso_dias ?? AVISO_PADRAO;
    const badge = lista.filter((t) => classificar(t, aviso(t), hoje) === 'vencendo').length;
    for (const t of lista) {
      const etapa = etapaAviso(t, aviso(t), hoje);
      if (!etapa) continue;
      const { titulo, corpo } = textoAviso(etapa, t)!;
      try {
        enviados += await enviarPush(supabase, userId, { titulo, corpo, badge, url: '/#tarefas', tag: `tarefa-${t.id}` });
        await marcar(t, etapa);
      } catch (e) {
        console.error('Falha no aviso da tarefa', t.id, e);
      }
    }
  }
  return { hoje, hora, pessoas: pessoas.length, tarefas: tarefas.length, enviados };
}

async function lembretes() {
  const { hoje, minutos } = agora();
  // Até 3h à frente pode cair no dia seguinte (tarefa à 0h30, agora 23h).
  const tarefas = await buscar((q) => q.not('hora', 'is', null).gte('vencimento', hoje).lte('vencimento', somarDias(hoje, 1)));
  let enviados = 0;
  for (const t of tarefas) {
    const etapa = etapaLembrete(t, hoje, minutos);
    if (!etapa) continue;
    const { titulo, corpo } = textoLembrete(etapa, t)!;
    try {
      enviados += await enviarPush(supabase, t.user_id, { titulo, corpo, url: '/#tarefas', tag: `lembrete-${t.id}` });
      await marcar(t, etapa);
    } catch (e) {
      console.error('Falha no lembrete da tarefa', t.id, e);
    }
  }
  return { hoje, tarefas: tarefas.length, enviados };
}

async function usuarioDoPedido(req: Request) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data.user;
}

async function metasDeTodos() {
  const { data, error } = await supabase.from('perfis').select('user_id').gt('meta_gasto', 0);
  if (error) throw error;
  let avisados = 0;
  for (const p of data ?? []) {
    try {
      if ((await conferirMeta(supabase, p.user_id)).enviado) avisados++;
    } catch (e) {
      console.error('Falha ao conferir meta', p.user_id, e);
    }
  }
  return avisados;
}

async function teste(req: Request) {
  const user = await usuarioDoPedido(req);
  if (!user) return resposta(401, { ok: false, erro: 'Entre na sua conta de novo.' });
  const enviados = await enviarPush(supabase, user.id, {
    titulo: 'Notificações funcionando',
    corpo: 'É assim que os avisos do Camarada vão chegar.',
    url: '/#ajustes',
    tag: 'teste',
  });
  return resposta(200, { ok: true, enviados });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { ok: false, erro: 'Use POST' });
  const corpo = await req.json().catch(() => ({}));
  const tipo = corpo?.tipo ?? 'diario';

  try {
    if (tipo === 'teste') return await teste(req);
    if (tipo === 'bomdia') {
      const user = await usuarioDoPedido(req);
      if (!user) return resposta(401, { ok: false, erro: 'Entre na sua conta de novo.' });
      const { hoje, hora } = agora();
      const msg = await mensagemDoDia(supabase, user.id, hoje, hora);
      const enviados = await enviarPush(supabase, user.id, { ...msg, url: '/#hoje', tag: 'bomdia-teste' });
      return resposta(200, { ok: true, tipo, ...msg, enviados });
    }
    if (tipo === 'meta') {
      const user = await usuarioDoPedido(req);
      if (!user) return resposta(401, { ok: false, erro: 'Entre na sua conta de novo.' });
      return resposta(200, { ok: true, tipo, ...(await conferirMeta(supabase, user.id)) });
    }
    if (!SEGREDO || req.headers.get('x-cron-secret') !== SEGREDO) return resposta(401, { ok: false, erro: 'Não autorizado' });
    if (tipo === 'lembretes') return resposta(200, { ok: true, tipo, ...(await lembretes()) });
    if (tipo === 'diario') {
      const { hoje, hora } = agora();
      const bomdia = await bomDia(supabase, hoje, hora);
      const resultado = await diario();
      return resposta(200, { ok: true, tipo, ...resultado, bomdia, metasAvisadas: await metasDeTodos() });
    }
    return resposta(400, { ok: false, erro: `Tipo desconhecido: ${tipo}` });
  } catch (e) {
    console.error(e);
    return resposta(500, { ok: false, erro: (e as Error).message });
  }
});
