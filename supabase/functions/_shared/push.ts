// Envio de notificações (Web Push) para os aparelhos de uma pessoa.
import webpush from 'npm:web-push@3.6.7';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

const publica = Deno.env.get('VAPID_PUBLIC_KEY');
const privada = Deno.env.get('VAPID_PRIVATE_KEY');
const contato = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:camarada@example.com';

if (publica && privada) webpush.setVapidDetails(contato, publica, privada);

export type Aviso = {
  titulo: string;
  corpo: string;
  url?: string;
  /** Número no ícone do app (tarefas em "Vencendo"). Omitido = não mexe. */
  badge?: number;
  tag?: string;
};

export async function enviarPush(supabase: SupabaseClient, userId: string, aviso: Aviso) {
  if (!publica || !privada) {
    console.warn('VAPID não configurado; notificação não enviada');
    return 0;
  }
  const { data: inscricoes, error } = await supabase
    .from('inscricoes_push')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);
  if (error) throw error;

  let enviados = 0;
  for (const i of inscricoes ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } },
        JSON.stringify(aviso),
        { TTL: 60 * 60 * 24 },
      );
      enviados++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // 404/410: o aparelho cancelou a inscrição (app removido, permissão revogada).
      if (status === 404 || status === 410) {
        await supabase.from('inscricoes_push').delete().eq('id', i.id);
      } else {
        console.error('Falha ao enviar push', status, e);
      }
    }
  }
  return enviados;
}
