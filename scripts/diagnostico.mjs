// Só leitura: chamadas recentes às funções do servidor (horário, caminho, status). Log público: sem dados.
import { CONFIG } from '../web/config.js';
const REF = new URL(CONFIG.supabaseUrl).hostname.split('.')[0];
const H = { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` };
const consultas = {
  borda: `select timestamp, event_message from function_edge_logs where timestamp > timestamp_sub(current_timestamp(), interval 40 minute) order by timestamp desc limit 30`,
  funcao: `select timestamp, event_message from function_logs where timestamp > timestamp_sub(current_timestamp(), interval 40 minute) order by timestamp desc limit 30`,
};
const fim = new Date().toISOString();
const inicio = new Date(Date.now() - 40 * 60000).toISOString();
for (const [nome, q] of Object.entries(consultas)) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs.all?sql=${encodeURIComponent(q)}&iso_timestamp_start=${inicio}&iso_timestamp_end=${fim}`, { headers: H });
  const j = await r.json().catch(() => ({}));
  console.log(`== ${nome}: http ${r.status} ${j.error ? JSON.stringify(j.error).slice(0, 300) : ''} ${j.message ?? ''}`);
  for (const l of j.result ?? []) {
    console.log(`${new Date(Number(l.timestamp) / 1000).toISOString().slice(11, 19)} ${String(l.event_message).replace(/[0-9a-f]{48}/g, '<token>').replace(/legado\/[\w-]+/g, 'legado/<seg>').slice(0, 220)}`);
  }
}
