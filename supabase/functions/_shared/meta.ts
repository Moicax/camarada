// Meta de gastos do mês: avisa quando a pessoa chega a 80% e a 100%, uma vez por mês cada.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { resumoMes, formatarReal } from './finance.js';
import { diaLocal, chaveMes } from './dates.js';
import { enviarPush } from './push.ts';

const FUSO = 'America/Sao_Paulo';

export async function conferirMeta(supabase: SupabaseClient, userId: string) {
  const { data: perfil, error: e1 } = await supabase.from('perfis').select('meta_gasto').eq('user_id', userId).maybeSingle();
  if (e1) throw e1;
  const meta = Number(perfil?.meta_gasto ?? 0);
  if (!(meta > 0)) return { nivel: null, motivo: 'sem meta' };

  const hoje = diaLocal(new Date(), FUSO);
  const mes = chaveMes(hoje);
  const [a, m] = mes.split('-').map(Number);
  // Mês em Brasília (UTC−3): de 1º às 0h até o dia 1º do mês seguinte às 0h.
  const inicio = new Date(Date.UTC(a, m - 1, 1, 3)).toISOString();
  const fim = new Date(Date.UTC(a, m, 1, 3)).toISOString();
  const { data: gastos, error: e2 } = await supabase
    .from('gastos').select('valor, data, forma, investimento')
    .eq('user_id', userId).gte('data', inicio).lt('data', fim);
  if (e2) throw e2;

  const r = resumoMes({ renda: 0, gastos: gastos ?? [], mes, hoje, timeZone: FUSO, metaGasto: meta });
  const mg = r.metaGasto!;
  if (!mg.nivel) return { nivel: null, pct: mg.pct };

  // Registra o nível (e o de 80%, se pulou direto para 100%). Só avisa se for novo.
  const niveis = mg.nivel === 100 ? [80, 100] : [80];
  const { data: novos, error: e3 } = await supabase
    .from('avisos_meta')
    .upsert(niveis.map((nivel) => ({ user_id: userId, mes, nivel })), { onConflict: 'user_id,mes,nivel', ignoreDuplicates: true })
    .select('nivel');
  if (e3) throw e3;
  if (!(novos ?? []).some((x) => x.nivel === mg.nivel)) return { nivel: mg.nivel, pct: mg.pct, enviado: false };

  const aviso = mg.nivel === 100
    ? {
      titulo: 'Meta de gastos atingida',
      corpo: `Você gastou ${formatarReal(mg.usado)} de ${formatarReal(mg.meta)} este mês.`,
    }
    : {
      titulo: `Atenção: ${Math.floor(mg.pct! * 100)}% da sua meta de gastos`,
      corpo: `Você gastou ${formatarReal(mg.usado)} de ${formatarReal(mg.meta)}. Restam ${formatarReal(mg.falta)} até o fim do mês.`,
    };
  const enviados = await enviarPush(supabase, userId, { ...aviso, url: '/#financas', tag: `meta-${mes}-${mg.nivel}` });
  return { nivel: mg.nivel, pct: mg.pct, enviado: true, enviados };
}
