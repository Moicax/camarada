// Avisos do Camarada: notificação no celular (Web Push) e a cópia de segurança do dia.
// Roda de hora em hora; no horário escolhido em Ajustes manda o que for novo, uma vez por dia.
// Cada função recebe o armazém de uma conta (armazemDe); rodadaDeTodos passa por todas.
import webpush from 'web-push';
import { separar, diasAte, hojeIso, somarDias, curta, horaCurta } from '../app/regras.js';
import { armazemDe, listarContas } from './contas.js';

const FUSO = 'America/Sao_Paulo';
const MAX_AVULSOS = 3;
const GUARDAR_MARCAS_DIAS = 120;
const GUARDAR_COPIAS = 14;

const tentar = async fn => {
  try { return await fn(); }
  catch (e) { return 'falhou: ' + String(e?.message || e).slice(0, 140); }
};

/* ---------- o que avisar ---------- */

// Cada tarefa em A expirar avisa uma vez em cada momento: quando entra, na véspera, no dia e depois de vencer.
export function avisosDoDia(dados, hoje, enviados = {}) {
  const cats = dados.categorias.filter(c => !c.apagado);
  const { expirar } = separar(dados.itens, hoje, cats, dados.preferencias.aviso_padrao ?? 7);
  const lista = [];
  for (const item of expirar) {
    const dias = diasAte(item.data_limite, hoje);
    const momento = dias < 0 ? 'venceu' : dias === 0 ? 'hoje' : dias === 1 ? 'vespera' : 'entrou';
    const chave = `${item.id}|${item.data_limite}|${momento}`;
    if (!enviados[chave]) lista.push({ item, dias, momento, chave });
  }
  return lista;
}

// Tocar na notificação abre Tarefas › A expirar (o "#expirar" no endereço).
export function mensagensPush(avisos, site) {
  const url = site + '/#expirar';
  if (avisos.length > MAX_AVULSOS) {
    const nomes = avisos.map(a => a.item.titulo);
    return [{ titulo: `${avisos.length} tarefas pedem atenção`, texto: nomes.slice(0, 4).join(' · ') + (nomes.length > 4 ? ' …' : ''), url, tag: 'resumo' }];
  }
  return avisos.map(({ item, dias, momento }) => {
    const as = item.hora ? ' · às ' + horaCurta(item.hora) : '';
    const [titulo, texto] = {
      entrou: ['Entrou em A expirar', `${item.titulo} · vence em ${dias} dias (${curta(item.data_limite)})`],
      vespera: ['Vence amanhã', item.titulo + as],
      hoje: ['Vence hoje', item.titulo + as],
      venceu: [dias === -1 ? 'Venceu ontem' : `Venceu há ${-dias} dias`, item.titulo]
    }[momento];
    return { titulo, texto, url, tag: item.id };
  });
}

/* ---------- tarefas com hora: faltando 3 h, 1 h e 10 min ---------- */

const MARCOS = [180, 60, 10]; // minutos antes da hora
const MAX_LEMBRETES = 5;
const GUARDAR_LEMBRETES_DIAS = 3;

// "2026-11-04" + "18:00" no horário de São Paulo → milissegundos. Usa o fuso de verdade (com ou sem horário de verão).
export function instante(dia, hora, fuso = FUSO) {
  const comoUtc = Date.parse(`${dia}T${hora}:00Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(comoUtc).map(x => [x.type, x.value]));
  const desvio = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - comoUtc;
  return comoUtc - desvio;
}

// Cada marco vale do momento dele até o próximo (3 h: de 3 h a 1 h antes; 1 h: até 10 min; 10 min: até a hora).
// Assim, se a rodada de um minuto falhar, o aviso sai na seguinte. Tarefa criada já em cima da hora
// avisa uma vez, com o tempo que falta de verdade.
export function lembretesDaHora(dados, agoraMs, enviados = {}) {
  const lista = [];
  for (const item of dados.itens) {
    if (item.apagado || item.concluido_em || !item.data_limite || !item.hora) continue;
    const falta = Math.round((instante(item.data_limite, item.hora) - agoraMs) / 60e3);
    if (falta <= 0 || falta > MARCOS[0]) continue;
    const marco = MARCOS.filter(m => falta <= m).at(-1);
    const chave = `${item.id}|${item.data_limite}|${item.hora}|${marco}`;
    if (!enviados[chave]) lista.push({ item, falta, marco, chave });
  }
  return lista.sort((a, b) => a.falta - b.falta);
}

// "Faltam 3 horas", "Falta 1 hora", "Faltam 10 minutos", "Falta 1 h 40 min".
function textoFalta(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m === 1 ? 'Falta' : 'Faltam'} ${m} ${m === 1 ? 'minuto' : 'minutos'}`;
  if (!m) return `${h === 1 ? 'Falta' : 'Faltam'} ${h} ${h === 1 ? 'hora' : 'horas'}`;
  return `${h === 1 ? 'Falta' : 'Faltam'} ${h} h ${m} min`;
}

export function mensagensLembrete(lembretes, site) {
  return lembretes.slice(0, MAX_LEMBRETES).map(({ item, falta, marco }) => ({
    // a rodada pode atrasar um ou dois minutos: perto do marco, fala o número redondo
    titulo: textoFalta(marco - falta <= 3 ? marco : falta),
    texto: `${item.titulo} · às ${horaCurta(item.hora)}`,
    url: site + '/#expirar',
    tag: `hora-${item.id}`
  }));
}

// Roda a cada minuto para uma conta. Só lê as marcas quando há algo na janela, para ficar leve.
export async function rodarLembretes(armazem, { agora = new Date(), site } = {}) {
  const dados = await armazem.ler('dados', null);
  if (!dados || !lembretesDaHora(dados, agora.getTime()).length) return { lembretes: 0 };
  const estado = await armazem.ler('lembretes', { enviados: {} });
  const novos = lembretesDaHora(dados, agora.getTime(), estado.enviados);
  if (!novos.length) return { lembretes: 0 };
  // marca antes de enviar: se outra rodada começar junto, não manda duas vezes
  const hoje = hojeIso(agora, FUSO);
  for (const n of novos) estado.enviados[n.chave] = hoje;
  const limite = somarDias(hoje, -GUARDAR_LEMBRETES_DIAS);
  for (const [chave, dia] of Object.entries(estado.enviados)) if (dia < limite) delete estado.enviados[chave];
  await armazem.gravar('lembretes', estado);
  return { lembretes: novos.length, push: await tentar(() => enviarPush(armazem, mensagensLembrete(novos, site), site)) };
}

export async function lembretesDeTodos(armazem, { agora, site } = {}) {
  const contas = await listarContas(armazem);
  const feitos = await Promise.all(contas.map(async ({ login, id }) => [login, await tentar(() => rodarLembretes(armazemDe(armazem, id), { agora, site }))]));
  return Object.fromEntries(feitos);
}

/* ---------- notificação no celular ---------- */

// As chaves são do app todo (ficam na raiz), não de cada conta.
export async function chavesPush(armazem) {
  const raiz = armazem.raiz || armazem;
  let chaves = await raiz.ler('chaves', null);
  if (!chaves) {
    const k = webpush.generateVAPIDKeys();
    chaves = { publica: k.publicKey, privada: k.privateKey };
    await raiz.gravar('chaves', chaves);
  }
  return chaves;
}

export async function inscreverPush(armazem, insc) {
  const valido = insc && typeof insc.endpoint === 'string' && /^https:\/\//.test(insc.endpoint) && insc.keys && insc.keys.p256dh && insc.keys.auth;
  if (!valido) throw Object.assign(new Error('inscrição inválida'), { status: 400 });
  const lista = (await armazem.ler('push', [])).filter(x => x.endpoint !== insc.endpoint);
  lista.push({
    endpoint: insc.endpoint.slice(0, 1000),
    keys: { p256dh: String(insc.keys.p256dh).slice(0, 200), auth: String(insc.keys.auth).slice(0, 100) },
    criado_em: new Date().toISOString()
  });
  await armazem.gravar('push', lista.slice(-10));
}

export async function cancelarPush(armazem, endpoint) {
  const lista = await armazem.ler('push', []);
  await armazem.gravar('push', lista.filter(x => x.endpoint !== endpoint));
}

async function enviarPush(armazem, mensagens, site) {
  const lista = await armazem.ler('push', []);
  if (!lista.length) return 'nenhum celular ativado';
  const chaves = await chavesPush(armazem);
  webpush.setVapidDetails(site.startsWith('https://') ? site : 'mailto:avisos@camarada.app', chaves.publica, chaves.privada);
  let entregues = 0;
  let erro = null;
  const mortos = new Set();
  for (const insc of lista) {
    for (const m of mensagens) {
      try {
        await webpush.sendNotification(insc, JSON.stringify(m), { TTL: 86400, urgency: 'high' });
        entregues++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) mortos.add(insc.endpoint);
        else erro = e.statusCode ? `recusado (${e.statusCode})` : String(e.message || e);
      }
    }
  }
  if (mortos.size) await armazem.gravar('push', lista.filter(x => !mortos.has(x.endpoint)));
  if (entregues) return 'ok';
  return erro ? 'falhou: ' + erro : 'o celular desativou os avisos';
}

/* ---------- cópia de segurança ---------- */

// Uma cópia dos dados por dia, guardando as últimas 14. Para voltar uma, é só copiar o conteúdo de "dados" de volta.
export async function fazerCopia(armazem, agora = new Date()) {
  const nome = 'copia-' + hojeIso(agora, FUSO);
  const existentes = await armazem.listar('copia-');
  if (!existentes.includes(nome)) {
    const dados = await armazem.ler('dados', null);
    if (!dados) return { copia: 'ainda sem dados' };
    await armazem.gravar(nome, { feita_em: agora.toISOString(), dados });
    existentes.push(nome);
  }
  const velhas = existentes.sort().slice(0, Math.max(0, existentes.length - GUARDAR_COPIAS));
  for (const v of velhas) await armazem.apagar(v);
  return { copia: nome, copias: existentes.length - velhas.length };
}

/* ---------- rodada de hora em hora ---------- */

export async function rodarAvisos(armazem, { agora = new Date(), site, forcar = false } = {}) {
  const dados = await armazem.ler('dados', null);
  if (!dados) return { feito: false, motivo: 'ainda sem dados' };
  const hoje = hojeIso(agora, FUSO);
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, hour: '2-digit', hourCycle: 'h23' }).format(agora));
  const horario = dados.preferencias.horario ?? 7;
  const estado = await armazem.ler('avisos', { enviados: {}, ultimo_dia: null });
  if (!forcar && (hora < horario || estado.ultimo_dia === hoje)) return { feito: false, motivo: 'fora do horário ou já enviado hoje' };

  const novos = avisosDoDia(dados, hoje, estado.enviados);
  const resultado = { feito: true, avisos: novos.length, push: 'nada novo' };
  const cats = dados.categorias.filter(c => !c.apagado);
  const { expirar } = separar(dados.itens, hoje, cats, dados.preferencias.aviso_padrao ?? 7);
  // "contagem" vira o número vermelho no ícone do app, mesmo com o app fechado.
  if (novos.length) resultado.push = await tentar(() => enviarPush(armazem, mensagensPush(novos, site).map(m => ({ ...m, contagem: expirar.length })), site));

  for (const a of novos) estado.enviados[a.chave] = hoje;
  const limite = somarDias(hoje, -GUARDAR_MARCAS_DIAS);
  for (const [chave, dia] of Object.entries(estado.enviados)) if (dia < limite) delete estado.enviados[chave];
  estado.ultimo_dia = hoje;
  estado.ultimo_resultado = { ...resultado, quando: agora.toISOString() };
  await armazem.gravar('avisos', estado);
  return resultado;
}

// A rodada de hora em hora: cópia do dia e avisos de cada conta. Uma conta com problema não para as outras.
export async function rodadaDeTodos(armazem, { agora, site } = {}) {
  const resultado = {};
  for (const { login, id } of await listarContas(armazem)) {
    const u = armazemDe(armazem, id);
    resultado[login] = {
      copia: await tentar(() => fazerCopia(u, agora)),
      avisos: await tentar(() => rodarAvisos(u, { agora, site }))
    };
  }
  return resultado;
}

// Uma notificação avulsa (usada quando um gasto do Apple Pay chega).
export const avisarNoCelular = (armazem, mensagem, site) => tentar(() => enviarPush(armazem, [mensagem], site));

// Botão "Enviar aviso de teste" em Ajustes.
export async function enviarTeste(armazem, site) {
  const dados = await armazem.ler('dados', null);
  const contagem = dados
    ? separar(dados.itens, hojeIso(new Date(), FUSO), dados.categorias.filter(c => !c.apagado), dados.preferencias.aviso_padrao ?? 7).expirar.length
    : 0;
  const push = await tentar(() => enviarPush(armazem, [{ titulo: 'Camarada', texto: 'Teste: os avisos estão chegando neste celular.', url: site + '/', tag: 'teste', contagem }], site));
  return { push };
}
