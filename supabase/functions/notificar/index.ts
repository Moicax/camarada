// Roda uma vez por dia (agendado no banco, ver README) e avisa sobre tarefas:
// quando entram em "Vencendo", na véspera, no dia e no dia seguinte ao vencimento.
// Também atualiza o número no ícone do app.
//
// Publicar com: supabase functions deploy notificar --no-verify-jwt
// Protegida pelo cabeçalho x-cron-secret (variável CRON_SECRET).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { diaLocal, somarDias } from '../_shared/dates.js';
import { classificar, etapaAviso, textoAviso, AVISO_PADRAO } from '../_shared/tasks.js';
import { enviarPush } from '../_shared/push.ts';

const FUSO = 'America/Sao_Paulo';
const SEGREDO = Deno.env.get('CRON_SECRET');

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

type Tarefa = {
  id: string;
  user_id: string;
  titulo: string;
  vencimento: string;
  concluida_em: string | null;
  avisos_enviados: string[];
  categorias: { aviso_dias: number } | null;
};

Deno.serve(async (req) => {
  if (!SEGREDO || req.headers.get('x-cron-secret') !== SEGREDO) {
    return new Response('Não autorizado', { status: 401 });
  }

  const hoje = diaLocal(new Date(), FUSO);
  const tarefas: Tarefa[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase
      .from('tarefas')
      .select('id, user_id, titulo, vencimento, concluida_em, avisos_enviados, categorias(aviso_dias)')
      .is('concluida_em', null)
      .lte('vencimento', somarDias(hoje, 90))
      .order('id')
      .range(de, de + 999);
    if (error) return new Response(`Erro: ${error.message}`, { status: 500 });
    tarefas.push(...(data as unknown as Tarefa[]));
    if (!data || data.length < 1000) break;
  }

  const porPessoa = new Map<string, Tarefa[]>();
  for (const t of tarefas) {
    const lista = porPessoa.get(t.user_id) ?? [];
    lista.push(t);
    porPessoa.set(t.user_id, lista);
  }

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
        await supabase
          .from('tarefas')
          .update({ avisos_enviados: [...(t.avisos_enviados ?? []), etapa] })
          .eq('id', t.id);
      } catch (e) {
        console.error('Falha no aviso da tarefa', t.id, e);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, hoje, tarefas: tarefas.length, enviados }), {
    headers: { 'content-type': 'application/json' },
  });
});
