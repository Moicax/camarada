import { api, MODO_DEMO } from './api.js';
import { CONFIG } from './config.js';
import { ic } from './icones.js';
import { diaLocal, chaveMes, mudarMes, nomeMes, rotuloDia, diaCurto, diasEntre } from './lib/dates.js';
import {
  separar, rotuloPrazo, OPCOES_ADIAR, adiar, AVISO_PADRAO, RECORRENCIAS, proximaOcorrencia, normalizarHora,
} from './lib/tasks.js';
import { resumoMes, formatarReal, lerValor, nomeCartao, FORMAS, tipoDe } from './lib/finance.js';
import { resumoCamarada, conselho, cumprimento, contarHoje } from './lib/camarada.js';
import { textoDaAutomacao, situacaoDoAtalho } from './lib/atalho.js';

// ---------------------------------------------------------------- utilidades

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hoje = () => diaLocal();
const raiz = $('#app');
const ehStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ehIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const estado = {
  usuario: null,
  iniciado: false,
  tela: 'hoje',
  historico: { gastos: [], rendas: {} },
  aba: null,
  perfil: null,
  categorias: [],
  tarefas: [],
  mes: chaveMes(hoje()),
  gastos: [],
  rendaMes: null,
  cartoes: [],
  automaticas: true,
  carregandoFinancas: false,
  entrada: { modo: 'entrar', erro: '', ok: '' },
};

function avisoDe(t) {
  const c = estado.categorias.find((x) => x.id === t.categoria_id);
  return c ? c.aviso_dias : AVISO_PADRAO;
}

function abasTarefas() {
  return separar(estado.tarefas, avisoDe, hoje());
}

function atualizarBadge() {
  const n = abasTarefas().vencendo.length;
  try {
    if (n > 0) navigator.setAppBadge?.(n);
    else navigator.clearAppBadge?.();
  } catch { /* sem suporte */ }
}

// ---------------------------------------------------------------- avisos e diálogos

let timerAviso;
function aviso(texto, desfazer) {
  document.querySelector('.aviso-flutuante')?.remove();
  clearTimeout(timerAviso);
  const el = document.createElement('div');
  el.className = 'aviso-flutuante';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(texto)}</span>${desfazer ? '<button type="button">Desfazer</button>' : ''}`;
  if (desfazer) {
    el.querySelector('button').onclick = () => { el.remove(); desfazer(); };
  }
  document.body.append(el);
  timerAviso = setTimeout(() => el.remove(), desfazer ? 5000 : 3000);
}

function confirmar({ titulo, texto = '', ok = 'OK', perigo = false, unico = false }) {
  return new Promise((resolve) => {
    const camada = document.createElement('div');
    camada.className = 'camada centro';
    camada.innerHTML = `
      <div class="dialogo" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t">
        <div class="dialogo-texto"><h3 id="dlg-t">${esc(titulo)}</h3>${texto ? `<p style="white-space:pre-line">${esc(texto)}</p>` : ''}</div>
        <div class="dialogo-botoes">
          ${unico ? '' : '<button type="button" data-r="0">Cancelar</button>'}
          <button type="button" data-r="1" class="${perigo ? 'perigo' : ''}">${esc(ok)}</button>
        </div>
      </div>`;
    const fim = (r) => { camada.remove(); resolve(r); };
    camada.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (b) fim(b.dataset.r === '1');
      else if (e.target === camada) fim(false);
    });
    document.body.append(camada);
    camada.querySelector('[data-r="1"]').focus();
  });
}

/** Abre uma folha que sobe de baixo. `montar(el, fechar)` liga os eventos. */
function abrirFolha(html, montar) {
  fecharFolha();
  const camada = document.createElement('div');
  camada.className = 'camada';
  camada.id = 'folha';
  camada.innerHTML = `<div class="folha" role="dialog" aria-modal="true"><div class="folha-alca"></div>${html}</div>`;
  camada.addEventListener('click', (e) => { if (e.target === camada) fecharFolha(); });
  document.body.append(camada);
  montar?.(camada.querySelector('.folha'), fecharFolha);
}

function fecharFolha() {
  $('#folha')?.remove();
}

async function tentar(fn, msgOk) {
  try {
    await fn();
    if (msgOk) aviso(msgOk);
    return true;
  } catch (e) {
    console.error(e);
    aviso(e.message || 'Algo deu errado. Tente de novo.');
    return false;
  }
}

// ---------------------------------------------------------------- carregar dados

/** Nível da meta de gastos no mês atual (80, 100 ou null), para o ponto de alerta na aba. */
function nivelDaMeta(gastos) {
  const r = resumoMes({ renda: 0, gastos, mes: chaveMes(hoje()), hoje: hoje(), ...metasDoPerfil() });
  return r.metaGasto?.nivel ?? null;
}

/** Gastos do mês anterior e do atual: base dos pontos, da sequência e do alerta da meta. */
async function carregarHistorico() {
  const mesAtual = chaveMes(hoje());
  const anterior = mudarMes(mesAtual, -1);
  try {
    const [gastos, rendas] = await Promise.all([api.gastosDesde(`${anterior}-01`), api.rendasDe([anterior, mesAtual])]);
    estado.historico = { gastos, rendas };
    estado.alertaMeta = Number(estado.perfil?.meta_gasto) > 0
      ? nivelDaMeta(gastos.filter((g) => chaveMes(diaLocal(new Date(g.data))) === mesAtual))
      : null;
  } catch (e) { console.warn('Histórico não carregado', e); }
}

const rendaDe = (mes) => Number(estado.historico.rendas[mes] ?? estado.perfil?.renda_mensal ?? 0);

function camaradaAgora() {
  return resumoCamarada({
    tarefas: estado.tarefas,
    gastos: estado.historico.gastos,
    rendaDe,
    hoje: hoje(),
    metaPontos: estado.perfil?.recompensa_pontos,
    recompensa: estado.perfil?.recompensa_texto,
    desde: estado.perfil?.criado_em ? diaLocal(new Date(estado.perfil.criado_em)) : undefined,
  });
}

/** Bateu os pontos da semana: comemora (uma vez por semana neste aparelho). */
function verificarRecompensa() {
  if (!estado.perfil || !estado.usuario) return;
  const c = camaradaAgora();
  if (!c.liberada) return;
  const chave = `camarada-comemorou-${c.semana.de}`;
  try {
    if (localStorage.getItem(chave)) return;
    localStorage.setItem(chave, '1');
  } catch { return; }
  const camada = document.createElement('div');
  camada.className = 'camada centro';
  camada.innerHTML = `
    <div class="dialogo comemoracao" role="alertdialog" aria-modal="true" aria-labelledby="com-t">
      <div class="dialogo-texto">
        <div class="trofeu-grande">${ic.trofeu}</div>
        <h3 id="com-t">Recompensa liberada!</h3>
        <p>Você fez ${c.pontos} pontos nesta semana.${c.recompensa ? ` Aproveite: <strong>${esc(c.recompensa)}</strong>` : ' Defina sua recompensa em Ajustes.'}</p>
      </div>
      <div class="dialogo-botoes"><button type="button">Valeu, camarada!</button></div>
    </div>`;
  camada.addEventListener('click', (e) => { if (e.target === camada || e.target.closest('button')) camada.remove(); });
  document.body.append(camada);
}

async function carregarTudo() {
  const [perfil, categorias, tarefas] = await Promise.all([api.perfil(), api.categorias(), api.tarefas()]);
  Object.assign(estado, { perfil, categorias, tarefas });
  if (!estado.aba) estado.aba = abasTarefas().vencendo.length ? 'vencendo' : 'pendentes';
  atualizarBadge();
  await carregarHistorico();
}

async function recarregarTarefas() {
  estado.tarefas = await api.tarefas();
  atualizarBadge();
  render();
  verificarRecompensa();
}

async function carregarFinancas() {
  estado.carregandoFinancas = true;
  const mes = estado.mes;
  const [gastos, rendaMes, cartoes, automaticas] = await Promise.all([
    api.gastosDoMes(mes), api.rendaDoMes(mes), api.cartoes(), api.temComprasAutomaticas(),
  ]);
  if (mes !== estado.mes) return; // trocou de mês enquanto carregava
  Object.assign(estado, { gastos, rendaMes, cartoes, automaticas, carregandoFinancas: false });
  if (mes === chaveMes(hoje())) estado.alertaMeta = nivelDaMeta(gastos);
  render();
  carregarHistorico().then(verificarRecompensa);
}

// ---------------------------------------------------------------- tela de entrada

function telaEntrada() {
  const { modo, erro, ok } = estado.entrada;
  const titulos = { entrar: 'Entrar', criar: 'Criar conta', esqueci: 'Esqueci minha senha', 'nova-senha': 'Nova senha' };
  const campos = { entrar: ['nome', 'senha'], criar: ['nome', 'senha'], esqueci: [], 'nova-senha': ['senha'] }[modo];
  const campo = {
    nome: `<div class="campo bloco"><input name="nome" autocomplete="username" autocapitalize="words" autocorrect="off" spellcheck="false" maxlength="60" placeholder="${modo === 'criar' ? 'Seu nome' : 'Nome'}" value="${esc(estado.entrada.nome)}" required></div>`,
    senha: `<div class="campo bloco"><input name="senha" type="password" minlength="6" autocomplete="${modo === 'entrar' ? 'current-password' : 'new-password'}" placeholder="${modo === 'entrar' ? 'Senha' : 'Senha (mínimo 6 caracteres)'}" required></div>`,
  };
  const textoTopo = {
    entrar: 'Suas tarefas e seu dinheiro, em ordem.',
    criar: 'Você foi convidado. Escolha o nome com que vai entrar e uma senha.',
    esqueci: '',
    'nova-senha': 'Escolha a sua senha nova.',
  }[modo];
  return `
    <main class="entrada">
      <div class="marca">
        <img src="icons/icon-192.png" alt="">
        <h1>Camarada</h1>
        ${textoTopo ? `<p>${textoTopo}</p>` : ''}
      </div>
      ${MODO_DEMO ? '<p class="aviso-demo">Modo demonstração: use qualquer nome e senha.</p>' : ''}
      ${modo === 'esqueci' ? `
        <div class="grupo"><div class="item" style="display:block;font-weight:500;line-height:1.45">
          Peça para quem cuida do Camarada abrir <strong>Ajustes → Pessoas</strong> e tocar em <strong>Nova senha</strong> no seu nome.
          Entre com a senha que aparecer e troque depois em <strong>Ajustes → Trocar senha</strong>.</div></div>
        <button class="link" data-acao="modo-entrada" data-modo="entrar">Voltar</button>` : `
      <form id="form-entrada" novalidate>
        <div class="grupo">${campos.map((c) => campo[c]).join('')}</div>
        ${erro ? `<p class="erro" role="alert">${esc(erro)}</p>` : ''}
        ${ok ? `<p class="ok-msg" role="status">${esc(ok)}</p>` : ''}
        <button class="btn-grande" type="submit">${titulos[modo]}</button>
      </form>`}
      ${modo === 'entrar' ? '<button class="link" data-acao="modo-entrada" data-modo="esqueci">Esqueci minha senha</button>' : ''}
      ${modo === 'criar' ? '<button class="link" data-acao="modo-entrada" data-modo="entrar">Já tenho conta</button>' : ''}
    </main>`;
}

async function enviarEntrada(form) {
  const dados = Object.fromEntries(new FormData(form));
  const { modo } = estado.entrada;
  const botao = form.querySelector('button[type=submit]');
  estado.entrada.erro = '';
  estado.entrada.ok = '';
  if (dados.nome !== undefined) estado.entrada.nome = dados.nome; // se der erro, o nome continua escrito
  if (dados.nome !== undefined && dados.nome.trim().length < 2) {
    estado.entrada.erro = 'Escreva o seu nome.';
    return render();
  }
  if (dados.senha !== undefined && dados.senha.length < 6) {
    estado.entrada.erro = 'A senha precisa ter pelo menos 6 caracteres.';
    return render();
  }
  botao.disabled = true;
  botao.textContent = 'Aguarde…';
  try {
    if (modo === 'entrar') await api.entrar(dados.nome.trim(), dados.senha);
    if (modo === 'criar') {
      await api.criarConta(estado.entrada.convite, dados.nome.trim(), dados.senha);
      history.replaceState(null, '', '#hoje');
    }
    if (modo === 'nova-senha') {
      await api.trocarSenha(dados.senha);
      estado.entrada = { modo: 'entrar', erro: '', ok: '' };
      aviso('Senha alterada');
      await iniciarApp();
    }
  } catch (e) {
    estado.entrada.erro = e.message;
    render();
  }
}

/** Link de convite: .../#convite=<código>. Abre direto em "Criar conta". */
async function lerConvite() {
  const m = location.hash.match(/^#convite=([0-9a-f]{36})$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  if (estado.usuario) {
    irPara('hoje');
    return aviso('Você já está numa conta. Para criar outra, saia primeiro.');
  }
  let valido = false;
  try { valido = await api.conviteValido(m[1]); } catch { /* sem internet */ }
  estado.entrada = valido
    ? { modo: 'criar', convite: m[1], erro: '', ok: '' }
    : { modo: 'entrar', erro: 'Este link de convite não vale mais. Peça um novo para quem te convidou.', ok: '' };
  render();
}

// ---------------------------------------------------------------- tela Hoje (o Camarada)

function saudacao() {
  const nome = (estado.perfil?.nome ?? '').trim().split(/\s+/)[0];
  return `${cumprimento(new Date().getHours())}${nome && nome !== 'Você' ? `, ${nome}` : ''}`;
}

const TEXTO_EVENTO = {
  tarefa: (e) => e.texto,
  'tarefa-atrasada': (e) => `${e.texto} (atrasada)`,
  limite: () => 'Dia dentro do limite',
  investimento: () => 'Dia com investimento',
};

function linhaEvento(e) {
  return `
    <li><div class="item evento">
      <span class="ev-pontos">+${e.pontos}</span>
      <span class="rotulo">${esc(TEXTO_EVENTO[e.tipo](e))}</span>
      <span class="valor-dir">${rotuloDia(e.dia, hoje()).split(',')[0]}</span>
    </div></li>`;
}

function linhaHoje(t) {
  const h = hoje();
  const atrasada = t.vencimento < h;
  return `
    <li><div class="item tarefa-hoje">
      <button class="marcar" data-acao="concluir" data-id="${t.id}" aria-label="Concluir ${esc(t.titulo)}">${ic.circulo}</button>
      <button class="tarefa-hoje-texto" data-acao="editar-tarefa" data-id="${t.id}">
        <strong>${esc(t.titulo)}</strong>
        <small class="${atrasada ? 'prazo-atrasado' : 'prazo-urgente'}">${rotuloPrazo(t.vencimento, h, t.hora)}</small>
      </button>
    </div></li>`;
}

function telaHoje() {
  const h = hoje();
  const c = camaradaAgora();
  const { atrasadas, vencemHoje } = contarHoje(estado.tarefas, h);
  const mesAtual = chaveMes(h);
  const temRenda = rendaDe(mesAtual) > 0;
  const fin = resumoMes({ renda: rendaDe(mesAtual), gastos: estado.historico.gastos, mes: mesAtual, hoje: h, ...metasDoPerfil() });
  const frase = conselho({
    atrasadas, vencemHoje, nivelMeta: fin.metaGasto?.nivel ?? null, restaHoje: temRenda ? fin.restaHoje : null, camarada: c,
  });
  const paraHoje = estado.tarefas
    .filter((t) => !t.concluida_em && t.vencimento && t.vencimento <= h)
    .sort((a, b) => (a.vencimento + (a.hora || '24')).localeCompare(b.vencimento + (b.hora || '24')));
  const recompensa = c.liberada
    ? `${ic.trofeu}<span>Recompensa liberada${c.recompensa ? `: <strong>${esc(c.recompensa)}</strong>` : '!'}</span>`
    : c.recompensa
      ? `${ic.presente}<span>Faltam ${c.falta} pontos para: <strong>${esc(c.recompensa)}</strong></span>`
      : `${ic.presente}<span>Defina sua recompensa da semana ›</span>`;
  const mg = fin.metaGasto;
  const mi = fin.metaInvestimento;
  return `
    <div class="camarada-cartao ${c.liberada ? 'liberada' : ''}">
      <div class="cc-topo">
        <span class="cc-rotulo">Sua semana</span>
        <span class="cc-seq" title="Dias seguidos fazendo o que precisa">${ic.fogo}${c.sequencia} ${c.sequencia === 1 ? 'dia' : 'dias'}</span>
      </div>
      <div class="cc-pontos"><span class="cc-num">${c.pontos}</span><span class="cc-meta">de ${c.meta} pontos</span></div>
      <div class="cc-barra" role="progressbar" aria-valuenow="${c.pontos}" aria-valuemin="0" aria-valuemax="${c.meta}" aria-label="Pontos da semana"><span style="width:${Math.round(c.pct * 100)}%"></span></div>
      <button class="cc-recompensa" data-acao="recompensa">${recompensa}</button>
    </div>

    <div class="conselho">
      <img src="icons/icon-192.png" alt="" class="conselho-avatar">
      <p>${esc(frase)}</p>
    </div>

    <h3 class="grupo-titulo">Para hoje</h3>
    <div class="grupo"><ul class="lista">
      ${paraHoje.length ? paraHoje.slice(0, 5).map(linhaHoje).join('') : '<li><div class="item"><span class="rotulo vazio-hoje">Nada vencendo hoje</span></div></li>'}
      <li><button class="item" data-acao="tela" data-tela="tarefas"><span class="rotulo">${paraHoje.length > 5 ? `Ver mais ${paraHoje.length - 5}` : 'Ver todas as tarefas'}</span><span class="valor-dir">›</span></button></li>
    </ul></div>

    <h3 class="grupo-titulo">Dinheiro</h3>
    <div class="grupo"><ul class="lista">
      <li><button class="item" data-acao="tela" data-tela="financas"><span class="rotulo">Para gastar hoje</span>
        <span class="valor-dir ${temRenda && fin.restaHoje < 0 ? 'ruim' : ''}">${temRenda ? formatarReal(fin.restaHoje) : 'informe a renda'} ›</span></button></li>
      ${mg ? `<li><button class="item" data-acao="metas"><span class="rotulo">${mg.nivel ? '<span class="sinal-meta">!</span> ' : ''}Meta de gastos</span>
        <span class="valor-dir ${mg.nivel === 100 ? 'ruim' : mg.nivel === 80 ? 'atencao' : ''}">${Math.round(mg.pct * 100)}% usada ›</span></button></li>` : ''}
      ${mi ? `<li><button class="item" data-acao="metas"><span class="rotulo">Investido</span>
        <span class="valor-dir">${formatarReal(mi.investido)} de ${formatarReal(mi.meta)} ›</span></button></li>` : ''}
    </ul></div>

    <h3 class="grupo-titulo">Pontos da semana</h3>
    <div class="grupo"><ul class="lista">
      ${c.eventos.length ? c.eventos.map(linhaEvento).join('') : '<li><div class="item"><span class="rotulo vazio-hoje">Ainda sem pontos nesta semana</span></div></li>'}
    </ul></div>
    <p class="dica" style="text-align:left;margin:-10px 4px 0">Tarefa no prazo +10 · atrasada +5 · dia dentro do limite +5 · dia com investimento +15. A semana vai de segunda a domingo.</p>`;
}

function folhaRecompensa() {
  const p = estado.perfil;
  abrirFolha(`
    <form>
      <div class="folha-topo"><button type="button" data-fechar>Cancelar</button><h2>Recompensa da semana</h2><button type="submit">Salvar</button></div>
      <div class="grupo">
        <div class="campo bloco"><input name="texto" maxlength="80" placeholder="Ex.: pizza no sábado, um filme, um doce" value="${esc(p.recompensa_texto)}" autofocus></div>
        <div class="campo"><label for="r-pontos">Com</label><input id="r-pontos" name="pontos" type="number" inputmode="numeric" min="10" max="10000" value="${Number(p.recompensa_pontos) || 100}"><span style="font-weight:600">pontos</span></div>
      </div>
      <p class="dica" style="margin:-10px 4px 14px;text-align:left">Uma semana boa dá uns 100 pontos: 5 tarefas no prazo (50), 7 dias dentro do limite (35) e um investimento (15). Quando você chegar lá, o Camarada comemora com você.</p>
      <p class="erro" hidden></p>
    </form>`,
  (el, fechar) => {
    el.querySelector('[data-fechar]').onclick = fechar;
    el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const pontos = Number(d.pontos);
      if (!Number.isInteger(pontos) || pontos < 10 || pontos > 10000) {
        const erro = el.querySelector('.erro');
        erro.textContent = 'Escolha entre 10 e 10.000 pontos.';
        erro.hidden = false;
        return;
      }
      const texto = d.texto.trim() || null;
      fechar();
      await tentar(async () => {
        await api.salvarPerfil({ recompensa_texto: texto, recompensa_pontos: pontos });
        Object.assign(estado.perfil, { recompensa_texto: texto, recompensa_pontos: pontos });
      }, 'Recompensa salva');
      render();
      verificarRecompensa();
    };
  });
}

async function verBomDia() {
  await tentar(async () => {
    const r = await api.bomDia();
    if (!r) return aviso('O bom dia funciona na versão publicada.');
    const camada = document.createElement('div');
    camada.className = 'camada centro';
    camada.innerHTML = `
      <div class="dialogo" role="alertdialog" aria-modal="true" aria-labelledby="bd-t">
        <div class="dialogo-texto"><h3 id="bd-t">${esc(r.titulo)}</h3><p>${esc(r.corpo)}</p>
        ${r.enviados ? '<p class="dica" style="margin:10px 0 0">Também chegou como notificação.</p>' : ''}</div>
        <div class="dialogo-botoes"><button type="button">OK</button></div>
      </div>`;
    camada.addEventListener('click', (e) => { if (e.target === camada || e.target.closest('button')) camada.remove(); });
    document.body.append(camada);
  });
}

// ---------------------------------------------------------------- tela Tarefas

const ICONE_ABA = { pendentes: ic.calendario, vencendo: ic.alerta, concluidas: ic.checkCirculo };
const NOME_ABA = { pendentes: 'Pendentes', vencendo: 'A expirar', concluidas: 'Concluídas' };

function telaTarefas() {
  const abas = abasTarefas();
  const lista = abas[estado.aba];
  const segmentos = Object.keys(NOME_ABA).map((aba) => {
    const n = abas[aba].length;
    const alerta = aba === 'vencendo' && n > 0;
    return `<button role="tab" aria-selected="${estado.aba === aba}" data-acao="aba" data-aba="${aba}">
      ${ICONE_ABA[aba]}${NOME_ABA[aba]}${aba !== 'concluidas' && n ? `<span class="contador ${alerta ? 'alerta' : ''}">${n}</span>` : ''}
    </button>`;
  }).join('');

  const vazios = {
    pendentes: ['Nada pendente', 'Toque em + para adicionar uma tarefa com prazo.'],
    vencendo: ['Tudo em dia', 'Nenhuma tarefa a expirar nos próximos dias.'],
    concluidas: ['Nenhuma tarefa concluída ainda', 'As tarefas concluídas aparecem aqui.'],
  };

  return `
    <div class="segmentos" role="tablist">${segmentos}</div>
    ${lista.length ? `
      ${estado.aba !== 'concluidas' ? '<p class="dica">Arraste → para concluir · ← para adiar ou apagar</p>' : ''}
      <div class="grupo"><ul class="lista">${lista.map(linhaTarefa).join('')}</ul></div>`
    : `<div class="vazio">${ICONE_ABA[estado.aba]}<strong>${vazios[estado.aba][0]}</strong>${vazios[estado.aba][1]}</div>`}`;
}

function linhaTarefa(t) {
  const cat = estado.categorias.find((c) => c.id === t.categoria_id);
  const feita = Boolean(t.concluida_em);
  const h = hoje();
  const faltam = t.vencimento ? diasEntre(h, t.vencimento) : null;
  const classePrazo = faltam === null ? '' : faltam < 0 ? 'prazo-atrasado' : faltam <= 1 ? 'prazo-urgente' : '';
  const prazo = faltam === null ? ''
    : `<span class="${classePrazo}" style="display:inline-flex;align-items:center;gap:4px">${faltam < 0 ? ic.alerta : ic.relogio}${rotuloPrazo(t.vencimento, h, t.hora)}</span>`;
  const sub = feita ? `${ic.check}Feita em ${diaCurto(diaLocal(new Date(t.concluida_em)))}` : prazo;
  const rec = RECORRENCIAS.find((r) => r.id === t.recorrencia);
  const repete = rec && !feita ? `<span class="repete" title="${rec.rotulo}" aria-label="Repete: ${rec.rotulo}">${ic.repetir}</span>` : '';
  const vencendo = !feita && faltam !== null && faltam <= avisoDe(t);
  return `
    <li class="linha ${feita ? 'feita' : ''}" data-id="${t.id}">
      <div class="linha-fundo">
        <div class="fundo-concluir" ${feita ? 'style="background:var(--azul)"' : ''}>${feita ? ic.desfazer + 'Reabrir' : ic.check + 'Concluir'}</div>
        <div class="fundo-acoes">
          ${feita ? '' : `<button class="b-adiar" data-acao="adiar" data-id="${t.id}">${ic.adiar}Adiar</button>`}
          <button class="b-apagar" data-acao="apagar-tarefa" data-id="${t.id}">${ic.lixeira}Apagar</button>
        </div>
      </div>
      <div class="linha-corpo" data-acao="editar-tarefa" data-id="${t.id}">
        <button class="marcar ${feita ? 'feito' : ''}" data-acao="${feita ? 'reabrir' : 'concluir'}" data-id="${t.id}" aria-label="${feita ? 'Reabrir' : 'Concluir'} ${esc(t.titulo)}">
          ${feita ? ic.checkCirculo : ic.circulo}
        </button>
        <div class="tarefa-texto">
          <div class="tarefa-titulo">${esc(t.titulo)}</div>
          ${sub || cat || repete ? `<div class="tarefa-sub">${sub}${repete}${cat ? `<span class="etiqueta">${esc(cat.nome)}</span>` : ''}</div>` : ''}
        </div>
        ${vencendo ? `<button class="btn-pilula so-icone" data-acao="adiar" data-id="${t.id}" aria-label="Adiar ${esc(t.titulo)}" title="Adiar">${ic.adiar}</button>` : ''}
      </div>
    </li>`;
}

async function concluir(id) {
  const t = estado.tarefas.find((x) => x.id === id);
  const proxima = proximaOcorrencia(t);
  const sim = await confirmar({
    titulo: 'Concluir tarefa?',
    texto: proxima ? `${t.titulo}. Como ela repete, a próxima fica para ${diaCurto(proxima.vencimento)}.` : t.titulo,
    ok: 'Concluir',
  });
  if (!sim) return;
  const quando = new Date().toISOString();
  t.concluida_em = quando;
  render();
  atualizarBadge();
  const ok = await tentar(async () => {
    await api.salvarTarefa({ id, concluida_em: quando });
    if (proxima) await api.salvarTarefa(proxima);
  });
  await recarregarTarefas();
  if (!ok) return;
  aviso(proxima ? `Feita · próxima em ${diaCurto(proxima.vencimento)}` : 'Tarefa concluída', async () => {
    await tentar(async () => {
      await api.salvarTarefa({ id, concluida_em: null });
      if (proxima) await api.apagarGeradas(id);
    });
    recarregarTarefas();
  });
}

async function reabrir(id) {
  await tentar(() => api.salvarTarefa({ id, concluida_em: null }), 'Tarefa reaberta');
  recarregarTarefas();
}

async function apagarTarefa(id) {
  const t = estado.tarefas.find((x) => x.id === id);
  const sim = await confirmar({ titulo: 'Apagar tarefa?', texto: t.titulo, ok: 'Apagar', perigo: true });
  if (!sim) return render();
  fecharFolha();
  await tentar(() => api.apagarTarefa(id), 'Tarefa apagada');
  recarregarTarefas();
}

function folhaAdiar(id) {
  const t = estado.tarefas.find((x) => x.id === id);
  const h = hoje();
  const base = t.vencimento && t.vencimento >= h ? t.vencimento : h;
  abrirFolha(`
    <div class="folha-topo"><button data-fechar>Cancelar</button><h2>Adiar</h2><span style="min-width:72px"></span></div>
    <p class="dica" style="margin:0 0 12px">${esc(t.titulo)} · ${rotuloPrazo(t.vencimento, h, t.hora)}</p>
    <div class="chips">
      ${OPCOES_ADIAR.map((o) => `<button data-opcao="${o.id}">${o.rotulo}<small>${rotuloDia(adiar(t.vencimento, o.id, h), h).replace('Hoje', 'hoje')}</small></button>`).join('')}
    </div>
    <div class="grupo"><div class="campo"><label for="adiar-data">Outra data</label><input id="adiar-data" type="date" min="${h}" value="${base}"></div></div>
    <button class="btn-grande" data-outra>Adiar para esta data</button>`,
  (el, fechar) => {
    el.querySelector('[data-fechar]').onclick = fechar;
    const salvar = async (data) => {
      fechar();
      const campos = { id, vencimento: data, avisos_enviados: [] };
      if (t.recorrencia) campos.dia_original = Number(data.slice(8, 10));
      await tentar(() => api.salvarTarefa(campos), `Adiada para ${diaCurto(data)}`);
      recarregarTarefas();
    };
    el.querySelectorAll('[data-opcao]').forEach((b) => { b.onclick = () => salvar(adiar(t.vencimento, b.dataset.opcao, h)); });
    el.querySelector('[data-outra]').onclick = () => {
      const v = el.querySelector('#adiar-data').value;
      if (v) salvar(v);
    };
  });
}

function folhaTarefa(id) {
  const t = id ? estado.tarefas.find((x) => x.id === id) : null;
  const catEscolhida = t ? t.categoria_id : estado.categorias.find((c) => c.nome === 'Geral')?.id;
  const opcoesCat = estado.categorias.map((c) =>
    `<option value="${c.id}" ${catEscolhida === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  const opcoesRep = RECORRENCIAS.map((r) => `<option value="${r.id}" ${t?.recorrencia === r.id ? 'selected' : ''}>${r.rotulo}</option>`).join('');
  const venc = t ? (t.vencimento ?? '') : hoje();
  abrirFolha(`
    <form id="form-tarefa">
      <div class="folha-topo"><button type="button" data-fechar>Cancelar</button><h2>${t ? 'Editar tarefa' : 'Nova tarefa'}</h2><button type="submit">Salvar</button></div>
      <div class="grupo">
        <div class="campo bloco"><input name="titulo" maxlength="120" placeholder="O que precisa ser feito?" value="${esc(t?.titulo)}" required ${t ? '' : 'autofocus'}></div>
      </div>
      <div class="grupo">
        <div class="campo"><label for="t-venc">Data</label><input id="t-venc" name="vencimento" type="date" value="${venc}"><button type="button" class="limpar" data-limpar="t-venc" aria-label="Sem data" ${venc ? '' : 'hidden'}>${ic.fechar}</button></div>
        <div class="campo"><label for="t-hora">Horário</label><input id="t-hora" name="hora" type="time" value="${normalizarHora(t?.hora) ?? ''}"><button type="button" class="limpar" data-limpar="t-hora" aria-label="Sem horário" ${t?.hora ? '' : 'hidden'}>${ic.fechar}</button></div>
        <div class="campo"><label for="t-rep">Repetir</label>
          <select id="t-rep" name="recorrencia"><option value="">Não repete</option>${opcoesRep}</select></div>
        <div class="campo"><label for="t-cat">Categoria</label>
          <select id="t-cat" name="categoria_id"><option value="">Nenhuma</option>${opcoesCat}</select></div>
      </div>
      <p class="dica" style="margin:-10px 4px 14px;text-align:left">Com horário, você recebe lembretes 3 horas, 1 hora e 10 minutos antes. Sem data, a tarefa fica em Pendentes.</p>
      <div class="grupo"><div class="campo bloco"><textarea name="notas" maxlength="2000" placeholder="Notas (opcional)">${esc(t?.notas)}</textarea></div></div>
      <p class="erro" hidden></p>
      ${t ? `<div class="grupo"><button type="button" class="item destrutivo" data-apagar>Apagar tarefa</button></div>` : ''}
    </form>`,
  (el, fechar) => {
    el.querySelector('[data-fechar]').onclick = fechar;
    el.querySelector('[data-apagar]')?.addEventListener('click', () => apagarTarefa(id));
    // Botão "x" para tirar a data ou o horário.
    el.querySelectorAll('[data-limpar]').forEach((b) => {
      const campo = el.querySelector(`#${b.dataset.limpar}`);
      b.onclick = () => { campo.value = ''; b.hidden = true; };
      campo.addEventListener('input', () => { b.hidden = !campo.value; });
    });
    el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const erro = el.querySelector('.erro');
      const falhar = (msg) => { erro.textContent = msg; erro.hidden = false; };
      if (!d.titulo.trim()) return falhar('Escreva o que precisa ser feito.');
      const hora = normalizarHora(d.hora);
      // Horário sem data vale para hoje.
      const vencimento = d.vencimento || (hora ? hoje() : null);
      const recorrencia = d.recorrencia || null;
      if (recorrencia && !vencimento) return falhar('Para repetir, escolha uma data.');
      const campos = {
        titulo: d.titulo.trim(),
        vencimento,
        hora,
        recorrencia,
        dia_original: recorrencia ? Number(vencimento.slice(8, 10)) : null,
        categoria_id: d.categoria_id || null,
        notas: d.notas.trim() || null,
      };
      if (t && (t.vencimento !== campos.vencimento || normalizarHora(t.hora) !== hora)) campos.avisos_enviados = [];
      fechar();
      await tentar(() => api.salvarTarefa(t ? { id, ...campos } : campos), t ? 'Tarefa salva' : 'Tarefa criada');
      if (!t) estado.aba = separar([campos], avisoDe, hoje()).vencendo.length ? 'vencendo' : 'pendentes';
      recarregarTarefas();
    };
  });
}

// ---------- arrastar (swipe) ----------

const LIMITE = 80;
const ABERTO = -168;

function ligarArrastar() {
  document.querySelectorAll('.linha-corpo').forEach((corpo) => {
    let x0 = 0; let y0 = 0; let dx = 0; let base = 0; let travado = null; let id = null;
    const linha = corpo.closest('.linha');
    const temAdiar = Boolean(linha.querySelector('.b-adiar'));
    const aberto = temAdiar ? ABERTO : ABERTO / 2;

    corpo.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      document.querySelectorAll('.linha-corpo').forEach((c) => {
        if (c !== corpo && c.style.transform) { c.style.transform = ''; c.dataset.aberto = ''; }
      });
      x0 = e.clientX; y0 = e.clientY; dx = 0; travado = null; id = e.pointerId;
      base = corpo.dataset.aberto ? aberto : 0;
    });
    corpo.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const mx = e.clientX - x0; const my = e.clientY - y0;
      if (travado === null && Math.hypot(mx, my) > 8) {
        travado = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
        if (travado === 'x') { corpo.setPointerCapture(id); corpo.classList.add('arrastando'); }
      }
      if (travado !== 'x') return;
      dx = Math.max(aberto - 40, Math.min(160, base + mx));
      corpo.style.transform = `translateX(${dx}px)`;
    });
    const soltar = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      corpo.classList.remove('arrastando');
      if (travado !== 'x') return;
      corpo.dataset.arrastou = '1';
      setTimeout(() => { corpo.dataset.arrastou = ''; }, 50);
      if (dx > LIMITE) {
        corpo.style.transform = '';
        corpo.dataset.aberto = '';
        const idTarefa = corpo.dataset.id;
        const feita = linha.classList.contains('feita');
        setTimeout(() => (feita ? reabrir(idTarefa) : concluir(idTarefa)), 150);
      } else if (dx < aberto / 2) {
        corpo.style.transform = `translateX(${aberto}px)`;
        corpo.dataset.aberto = '1';
      } else {
        corpo.style.transform = '';
        corpo.dataset.aberto = '';
      }
    };
    corpo.addEventListener('pointerup', soltar);
    corpo.addEventListener('pointercancel', soltar);
  });
}

// ---------------------------------------------------------------- tela Finanças

function rendaAtual() {
  return estado.rendaMes ?? Number(estado.perfil?.renda_mensal ?? 0);
}

/**
 * Explica de onde vem o limite do dia, para ninguém confundir com o saldo:
 * "R$ 2.800,00 que restam ÷ 26 dias = R$ 107,69 por dia".
 * O limite é calculado com o que restava no começo do dia; o gasto de hoje sai do "ainda dá".
 */
/** Valor de destaque: "R$" discreto, reais grandes e centavos menores. */
/** Valor dos cartões de números: "R$" pequeno para o valor caber inteiro. */
function valorMini(n) {
  const txt = formatarReal(n);
  const negativo = txt.startsWith('-');
  return `<span class="rs">${negativo ? '−' : ''}R$</span>${txt.replace(/^-?R\$ /, '')}`;
}

function valorGrande(n) {
  const [inteiro, cent] = formatarReal(n).replace('R$ ', '').split(',');
  return `<span class="moeda">R$</span><span class="reais">${inteiro}</span><span class="cent">,${cent}</span>`;
}

function explicarLimite(r) {
  const restavam = Math.round((r.resta + r.gastoHoje) * 100) / 100;
  const dias = r.diasRestantes === 1 ? 'hoje, último dia do mês' : `${r.diasRestantes} dias`;
  const conta = `${formatarReal(restavam)} ${r.gastoHoje ? 'que restavam hoje cedo' : 'que restam no mês'} ÷ ${dias} = <strong>${formatarReal(r.porDia)} por dia</strong>`;
  return r.gastoHoje ? `${conta}<br>Hoje você já gastou ${formatarReal(r.gastoHoje)}` : conta;
}

const metasDoPerfil = () => ({
  metaGasto: Number(estado.perfil?.meta_gasto) || 0,
  metaInvestimento: Number(estado.perfil?.meta_investimento) || 0,
});

/** "Metas do mês": meta de gastos (com alerta aos 80% e 100%) e meta de investimento. */
function cartaoMetas(r) {
  const pct = (x) => `${Math.min(100, Math.round(x * 100))}%`;
  const mg = r.metaGasto;
  const mi = r.metaInvestimento;
  let gasto;
  if (mg) {
    const classe = mg.nivel === 100 ? 'passou' : mg.nivel === 80 ? 'alerta' : '';
    const nota = mg.nivel === 100
      ? (mg.falta < 0 ? `Passou ${formatarReal(-mg.falta)} da meta` : 'Você chegou ao máximo do mês')
      : mg.nivel === 80 ? `Atenção: ${pct(mg.pct)} da meta · restam ${formatarReal(mg.falta)}`
        : `${pct(mg.pct)} · restam ${formatarReal(mg.falta)}`;
    gasto = `
      <button class="meta-linha ${classe}" data-acao="metas">
        <span class="meta-topo"><span class="meta-nome">${mg.nivel ? '<span class="sinal-meta" aria-label="Alerta">!</span>' : ''}Gastos</span>
          <span class="meta-valores"><strong>${formatarReal(mg.usado)}</strong> de ${formatarReal(mg.meta)}</span></span>
        <span class="barra"><span style="width:${mg.pct > 0 ? Math.max(2, Math.min(100, mg.pct * 100)) : 0}%"></span></span>
        <span class="meta-nota">${nota}</span>
      </button>`;
  } else {
    gasto = `<button class="meta-linha vazia" data-acao="metas"><span class="meta-topo"><span class="meta-nome">Gastos</span><span class="meta-valores">Definir máximo do mês ›</span></span></button>`;
  }
  const investido = r.investido;
  const nota = mi
    ? (mi.atingida ? 'Meta atingida' : `${pct(mi.pct)} · faltam ${formatarReal(mi.falta)}`)
    : (investido ? 'Sem meta definida' : 'Defina quanto quer investir por mês');
  const invest = `
    <div class="meta-linha ${mi?.atingida ? 'atingida' : ''}">
      <button class="meta-topo" data-acao="metas"><span class="meta-nome">Investimentos</span>
        <span class="meta-valores">${mi ? `<strong>${formatarReal(investido)}</strong> de ${formatarReal(mi.meta)}` : investido ? `<strong>${formatarReal(investido)}</strong>` : 'Definir meta ›'}</span></button>
      ${mi ? `<span class="barra investir"><span style="width:${mi.pct > 0 ? Math.max(2, Math.min(100, mi.pct * 100)) : 0}%"></span></span>` : ''}
      <span class="meta-rodape"><span class="meta-nota">${nota}</span>
        <button class="btn-pilula" data-acao="investir">${ic.investir}Investir</button></span>
    </div>`;
  return `<h3 class="grupo-titulo">Metas do mês</h3><div class="grupo metas">${gasto}${invest}</div>`;
}

function telaFinancas() {
  const h = hoje();
  const mesAtual = chaveMes(h);
  const renda = rendaAtual();
  const r = resumoMes({ renda, gastos: estado.gastos, mes: estado.mes, hoje: h, ...metasDoPerfil() });
  const ehAtual = estado.mes === mesAtual;

  let destaque;
  if (!renda) {
    destaque = `
      <div class="destaque">
        <div class="legenda">Quanto você recebe por mês?</div>
        <div class="detalhe" style="margin:6px 0 12px">Com a renda, o Camarada calcula quanto dá para gastar por dia.</div>
        <button class="btn-grande" data-acao="renda">Informar renda</button>
      </div>`;
  } else if (ehAtual) {
    destaque = `
      <div class="destaque">
        <div class="legenda">${r.restaHoje >= 0 ? 'Hoje ainda dá para gastar' : 'Hoje você passou do limite em'}</div>
        <div class="grande ${r.restaHoje >= 0 ? 'ok' : 'ruim'}">${valorGrande(Math.abs(r.restaHoje))}</div>
        <div class="detalhe">${explicarLimite(r)}</div>
      </div>`;
  } else if (estado.mes < mesAtual) {
    destaque = `
      <div class="destaque">
        <div class="legenda">${r.resta >= 0 ? 'Sobrou neste mês' : 'Passou do orçamento em'}</div>
        <div class="grande ${r.resta >= 0 ? 'ok' : 'ruim'}">${valorGrande(Math.abs(r.resta))}</div>
      </div>`;
  } else {
    destaque = `
      <div class="destaque">
        <div class="legenda">Para gastar por dia</div>
        <div class="grande ok">${valorGrande(r.porDia)}</div>
      </div>`;
  }

  const pct = r.percentual === null ? 0 : Math.min(100, r.percentual * 100);
  const convite = ehAtual && !estado.automaticas && !estado.perfil?.atalho_antigo ? `
    <button class="convite" data-acao="automaticas">
      <span class="gasto-icone auto">${ic.raio}</span>
      <span><strong>Ative as compras automáticas</strong><span>Cada compra com Apple Pay aparece aqui sozinha. Leva 1 minuto.</span></span>
    </button>` : '';

  // Crédito vai para a fatura; à vista (débito, Pix, dinheiro) sai do salário na hora.
  const formas = r.gasto ? `
    <div class="dois">
      <div class="mini"><div class="legenda">${ic.cartao} No crédito</div><div class="num">${valorMini(r.credito)}</div><div class="nota">vai para a fatura</div></div>
      <div class="mini"><div class="legenda">${ic.carteira} À vista</div><div class="num">${valorMini(r.avista)}</div><div class="nota">débito, Pix, dinheiro</div></div>
    </div>` : '';
  const faturas = r.faturas.length ? `
    <h3 class="grupo-titulo">Faturas do mês</h3>
    <div class="grupo">${r.faturas.map((c) => `
      <div class="cartao-linha">
        <div class="cartao-topo"><span>${ic.cartao}${esc(c.cartao)} <small>${c.quantidade} ${c.quantidade === 1 ? 'compra' : 'compras'}</small></span><span>${formatarReal(c.total)}</span></div>
        <div class="barra"><span style="width:${r.credito > 0 ? Math.max(2, (c.total / r.credito) * 100) : 0}%"></span></div>
      </div>`).join('')}
    </div>` : '';

  const porDia = new Map();
  for (const g of r.gastos) {
    if (!porDia.has(g.dia)) porDia.set(g.dia, []);
    porDia.get(g.dia).push(g);
  }
  const listaGastos = r.gastos.length
    ? [...porDia].map(([dia, lista]) => `
        <h3 class="grupo-titulo">${rotuloDia(dia, h)}${totalDoDia(lista)}</h3>
        <div class="grupo"><ul class="lista">${lista.map(linhaGasto).join('')}</ul></div>`).join('')
    : `<div class="vazio">${ic.carteira}<strong>Nenhum gasto ${ehAtual ? 'neste mês ainda' : 'neste mês'}</strong>${ehAtual ? 'Toque em + para lançar um gasto.' : ''}</div>`;

  return `
    <div class="mes-nav">
      <button data-acao="mes" data-delta="-1" aria-label="Mês anterior">${ic.esquerda}</button>
      <strong>${nomeMes(estado.mes)}</strong>
      <button data-acao="mes" data-delta="1" aria-label="Próximo mês" ${estado.mes >= mesAtual ? 'disabled' : ''}>${ic.direita}</button>
    </div>
    ${destaque}
    <div class="tres">
      <button class="mini" data-acao="renda"><div class="legenda">Renda ›</div><div class="num">${valorMini(r.renda)}</div>${r.entradas ? `<div class="nota mais">+ ${formatarReal(r.entradas)} de entradas</div>` : ''}</button>
      <div class="mini"><div class="legenda">Gasto</div><div class="num">${valorMini(r.gasto)}</div></div>
      <div class="mini"><div class="legenda">Resta no mês</div><div class="num ${r.resta < 0 ? 'ruim' : ''}">${valorMini(r.resta)}</div></div>
    </div>
    ${renda ? `<div class="barra barra-geral ${pct >= 100 ? 'ruim' : ''}" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100" aria-label="Quanto da renda já foi gasto"><span style="width:${pct}%"></span></div>` : ''}
    ${cartaoMetas(r)}
    ${formas}
    ${convite}
    ${faturas}
    ${listaGastos}`;
}

/** Cabeçalho do dia: total gasto e, se houver, quanto entrou e quanto foi investido. */
function totalDoDia(lista) {
  const c = (v) => Math.round(v * 100);
  const soma = (tipos, sinal = 1) => lista.filter((g) => tipos.includes(g.tipo)).reduce((t, g) => t + sinal * c(g.valor), 0) / 100;
  const gasto = soma(['gasto', 'estorno']);
  const entrou = soma(['entrada'], -1);
  const investiu = soma(['investimento', 'resgate']);
  return `${gasto ? ` · ${formatarReal(gasto)}` : ''}${entrou ? ` · entrou ${formatarReal(entrou)}` : ''}${investiu ? ` · investiu ${formatarReal(investiu)}` : ''}`;
}

const ROTULO_TIPO = { entrada: 'Entrada', investimento: 'Investimento', resgate: 'Resgate', estorno: 'Estorno' };

function linhaGasto(g) {
  const hora = new Date(g.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const auto = g.origem === 'atalho';
  const entrada = g.tipo === 'entrada';
  const investe = g.tipo === 'investimento' || g.tipo === 'resgate';
  const meta = entrada || investe ? [ROTULO_TIPO[g.tipo], hora]
    : [g.cartao, g.tipo === 'estorno' ? 'Estorno' : g.forma === 'avista' ? 'À vista' : (g.cartao ? '' : 'Crédito'), hora];
  const icone = entrada ? ic.entrada : investe ? ic.investir : auto ? ic.raio : ic.carteira;
  const classe = entrada ? 'entrada' : investe ? 'investe' : auto ? 'auto' : '';
  const titulo = entrada ? 'Entrada' : investe ? 'Investimento' : auto ? 'Registrado pelo Apple Pay' : 'Lançado à mão';
  return `
    <li><button class="gasto" data-acao="editar-gasto" data-id="${g.id}">
      <span class="gasto-icone ${classe}" title="${titulo}">${icone}</span>
      <span class="gasto-texto"><strong>${esc(g.estabelecimento || ROTULO_TIPO[g.tipo] || 'Gasto')}</strong><small>${meta.filter(Boolean).map(esc).join(' · ')}</small></span>
      <span class="gasto-valor ${g.valor < 0 && !investe ? 'negativo' : ''}">${g.valor < 0 && !investe ? '+' : ''}${formatarReal(Math.abs(g.valor))}</span>
    </button></li>`;
}

/** Texto do efeito no que dá para gastar: gasto e investimento tiram, entrada soma. */
const efeito = (valor) => (valor >= 0 ? `${formatarReal(valor)} a menos para gastar` : `${formatarReal(-valor)} a mais para gastar`);

/** Pede ao servidor para conferir a meta de gastos (ele manda o aviso dos 80%/100%). */
function avisarMeta() {
  if (Number(estado.perfil?.meta_gasto) > 0) api.conferirMeta().catch((e) => console.warn('Meta não conferida', e));
}

const TIPOS_LANCAMENTO = {
  gasto: { rotulo: 'Gasto', titulo: 'gasto', onde: 'Onde', exemplo: 'Mercado, farmácia…' },
  entrada: { rotulo: 'Entrada', titulo: 'entrada', onde: 'De onde', exemplo: 'Freela, Pix recebido…' },
  investimento: { rotulo: 'Investir', titulo: 'investimento', onde: 'Onde', exemplo: 'Tesouro, CDB, corretora…' },
};

function folhaGasto(id, tipoPedido) {
  const g = id ? estado.gastos.find((x) => x.id === id) : null;
  const dia = g ? diaLocal(new Date(g.data)) : hoje();
  const tipoG = g ? tipoDe(g) : null;
  const tipoInicial = g ? (tipoG === 'entrada' ? 'entrada' : g.investimento ? 'investimento' : 'gasto') : (tipoPedido || 'gasto');
  const valorInicial = g ? (tipoInicial === 'entrada' ? -g.valor : g.valor) : null;
  const valorTexto = valorInicial === null ? '' : valorInicial.toFixed(2).replace('.', ',');
  let ultimaForma = 'credito';
  try { ultimaForma = localStorage.getItem('camarada-ultima-forma') || 'credito'; } catch { /* sem armazenamento */ }
  const formaInicial = g ? (g.forma === 'avista' ? 'avista' : 'credito') : ultimaForma;
  const titulo = (tipo) => `${g ? 'Editar' : tipo === 'gasto' ? 'Novo' : 'Nova'} ${TIPOS_LANCAMENTO[tipo].titulo}`.replace('Nova investimento', 'Novo investimento');
  abrirFolha(`
    <form id="form-gasto">
      <div class="folha-topo"><button type="button" data-fechar>Cancelar</button><h2 data-titulo>${titulo(tipoInicial)}</h2><button type="submit">Salvar</button></div>
      <div class="segmentos tres-segmentos" role="radiogroup" aria-label="Tipo de lançamento">
        ${Object.entries(TIPOS_LANCAMENTO).map(([t, x]) => `<label><input type="radio" name="tipo" value="${t}" ${tipoInicial === t ? 'checked' : ''}><span>${x.rotulo}</span></label>`).join('')}
      </div>
      <div class="grupo">
        <div class="campo"><label for="g-valor">Valor</label><input id="g-valor" name="valor" inputmode="decimal" placeholder="R$ 0,00" value="${esc(valorTexto)}" required ${g ? '' : 'autofocus'}></div>
        <div class="campo"><label for="g-onde" data-rotulo-onde>${TIPOS_LANCAMENTO[tipoInicial].onde}</label><input id="g-onde" name="estabelecimento" maxlength="120" placeholder="${TIPOS_LANCAMENTO[tipoInicial].exemplo}" value="${esc(g?.estabelecimento)}"></div>
        <div class="campo" data-so="gasto"><label for="g-cartao">Cartão</label><input id="g-cartao" name="cartao" list="lista-cartoes" maxlength="60" placeholder="Opcional" value="${esc(g?.cartao)}"></div>
        <div class="campo"><label for="g-dia">Dia</label><input id="g-dia" name="dia" type="date" max="${hoje()}" value="${dia}" required></div>
      </div>
      <div data-so="gasto">
        <div class="segmentos dois-segmentos" role="radiogroup" aria-label="Forma de pagamento">
          ${FORMAS.map((f) => `<label><input type="radio" name="forma" value="${f.id}" ${formaInicial === f.id ? 'checked' : ''}><span>${f.rotulo}</span></label>`).join('')}
        </div>
        <p class="dica" style="margin:-8px 4px 14px;text-align:left">Crédito vai para a fatura do cartão. À vista (débito, Pix, dinheiro) sai do salário na hora.</p>
      </div>
      <p class="dica" data-so="entrada" style="margin:0 4px 14px;text-align:left">Dinheiro que entrou além da renda do mês: soma no que dá para gastar e se espalha pelos dias que faltam.</p>
      <p class="dica" data-so="investimento" style="margin:0 4px 14px;text-align:left">Sai do que dá para gastar no mês, mas não conta como gasto. Conta para a sua meta de investimento.</p>
      <datalist id="lista-cartoes">${estado.cartoes.map((c) => `<option value="${esc(c.nome)}">`).join('')}</datalist>
      ${g?.origem === 'atalho' ? '<p class="dica" style="margin:0 0 14px">Registrado automaticamente pelo Apple Pay.</p>' : ''}
      <p class="erro" hidden></p>
      ${g ? `<div class="grupo"><button type="button" class="item destrutivo" data-apagar>Apagar ${TIPOS_LANCAMENTO[tipoInicial].titulo}</button></div>` : ''}
    </form>`,
  (el, fechar) => {
    el.querySelector('[data-fechar]').onclick = fechar;
    const tipoAtual = () => el.querySelector('input[name=tipo]:checked').value;
    const mostrarTipo = () => {
      const tipo = tipoAtual();
      el.querySelectorAll('[data-so]').forEach((x) => { x.hidden = x.dataset.so !== tipo; });
      el.querySelector('[data-titulo]').textContent = titulo(tipo);
      el.querySelector('[data-rotulo-onde]').textContent = TIPOS_LANCAMENTO[tipo].onde;
      el.querySelector('#g-onde').placeholder = TIPOS_LANCAMENTO[tipo].exemplo;
    };
    el.querySelectorAll('input[name=tipo]').forEach((r) => r.addEventListener('change', mostrarTipo));
    mostrarTipo();
    // Cartão marcado como débito em Ajustes: já escolhe "À vista".
    el.querySelector('#g-cartao').addEventListener('change', (e) => {
      const c = estado.cartoes.find((x) => x.nome.toLowerCase() === e.target.value.trim().toLowerCase());
      if (c) el.querySelector(`input[name=forma][value=${c.debito ? 'avista' : 'credito'}]`).checked = true;
    });
    el.querySelector('[data-apagar]')?.addEventListener('click', async () => {
      const nome = TIPOS_LANCAMENTO[tipoInicial].titulo;
      const valor = formatarReal(Math.abs(g.valor));
      const volta = tipoInicial === 'entrada' ? 'Esse valor sai do que dá para gastar.' : 'Esse valor volta para o que dá para gastar.';
      const sim = await confirmar({ titulo: `Apagar ${nome}?`, texto: `${g.estabelecimento || ROTULO_TIPO[tipoG] || 'Gasto'} · ${valor}. ${volta}`, ok: 'Apagar', perigo: true });
      if (!sim) return;
      fechar();
      const ok = await tentar(() => api.apagarGasto(id));
      await carregarFinancas();
      if (!ok) return;
      avisarMeta();
      const apagado = `${nome[0].toUpperCase()}${nome.slice(1)} ${tipoInicial === 'gasto' ? 'apagado' : tipoInicial === 'entrada' ? 'apagada' : 'apagado'}`;
      aviso(`${apagado} · ${valor} ${tipoInicial === 'entrada' ? 'a menos' : 'a mais'} para gastar`, async () => {
        await tentar(() => api.restaurarGasto(g), 'Lançamento restaurado');
        await carregarFinancas();
        avisarMeta();
      });
    });
    el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const tipo = TIPOS_LANCAMENTO[d.tipo] ? d.tipo : 'gasto';
      const digitado = lerValor(d.valor);
      const erro = el.querySelector('.erro');
      if (!Number.isFinite(digitado) || digitado === 0) {
        erro.textContent = 'Digite um valor, por exemplo 23,90.';
        erro.hidden = false;
        return;
      }
      // Mantém a hora original se o dia não mudou; lançamento novo de hoje usa a hora atual.
      let data;
      if (g && d.dia === dia) data = g.data;
      else if (d.dia === hoje()) data = new Date().toISOString();
      else data = new Date(`${d.dia}T12:00:00`).toISOString();
      const onde = d.estabelecimento.trim() || null;
      let campos;
      if (tipo === 'entrada') {
        // Entrada fica guardada com valor negativo (dinheiro que entrou), sempre à vista e sem cartão.
        campos = { valor: -Math.abs(digitado), estabelecimento: onde, cartao: null, forma: 'avista', investimento: false, data };
      } else if (tipo === 'investimento') {
        campos = { valor: digitado, estabelecimento: onde, cartao: null, forma: 'avista', investimento: true, data };
      } else {
        const forma = d.forma === 'avista' ? 'avista' : 'credito';
        try { localStorage.setItem('camarada-ultima-forma', forma); } catch { /* sem armazenamento */ }
        campos = { valor: digitado, estabelecimento: onde, cartao: nomeCartao(d.cartao), forma, investimento: false, data };
      }
      fechar();
      const lancado = { gasto: 'Gasto lançado', entrada: 'Entrada lançada', investimento: 'Investimento lançado' }[tipo];
      let msg;
      if (!g) msg = `${lancado} · ${efeito(campos.valor)}`;
      else if (chaveMes(d.dia) !== chaveMes(dia)) msg = `Movido para ${nomeMes(chaveMes(d.dia)).toLowerCase()}`;
      else if (campos.valor === g.valor) msg = 'Salvo';
      else msg = `Salvo · ${efeito(campos.valor - g.valor)}`;
      await tentar(() => api.salvarGasto(g ? { id, ...campos } : campos), msg);
      const mesGasto = chaveMes(d.dia);
      if (mesGasto !== estado.mes) estado.mes = mesGasto;
      await carregarFinancas();
      avisarMeta();
    };
  });
}

/** Metas do mês: máximo para gastar e quanto investir (vazio = sem meta). */
function folhaMetas() {
  const p = estado.perfil;
  const texto = (v) => (Number(v) > 0 ? Number(v).toFixed(2).replace('.', ',') : '');
  abrirFolha(`
    <form>
      <div class="folha-topo"><button type="button" data-fechar>Cancelar</button><h2>Metas do mês</h2><button type="submit">Salvar</button></div>
      <h3 class="grupo-titulo" style="margin-top:4px">Meta de gastos</h3>
      <div class="grupo"><div class="campo"><label for="m-gasto">Máximo</label><input id="m-gasto" name="meta_gasto" inputmode="decimal" placeholder="Sem meta" value="${texto(p.meta_gasto)}"></div></div>
      <p class="dica" style="margin:-10px 4px 0;text-align:left">O máximo que você quer gastar no mês. Aos 80% aparece um alerta e chega uma notificação; aos 100%, outra.</p>
      <h3 class="grupo-titulo">Meta de investimento</h3>
      <div class="grupo"><div class="campo"><label for="m-inv">Investir</label><input id="m-inv" name="meta_investimento" inputmode="decimal" placeholder="Sem meta" value="${texto(p.meta_investimento)}"></div></div>
      <p class="dica" style="margin:-10px 4px 14px;text-align:left">Quanto você quer investir por mês. O que você investe sai do que dá para gastar.</p>
      <p class="erro" hidden></p>
    </form>`,
  (el, fechar) => {
    el.querySelector('[data-fechar]').onclick = fechar;
    el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const ler = (v) => (v.trim() ? lerValor(v) : 0);
      const metaGasto = ler(d.meta_gasto);
      const metaInv = ler(d.meta_investimento);
      if (![metaGasto, metaInv].every((v) => Number.isFinite(v) && v >= 0)) {
        const erro = el.querySelector('.erro');
        erro.textContent = 'Digite valores como 1.500,00, ou deixe em branco para ficar sem meta.';
        erro.hidden = false;
        return;
      }
      fechar();
      const ok = await tentar(async () => {
        await api.salvarPerfil({ meta_gasto: metaGasto, meta_investimento: metaInv });
        Object.assign(estado.perfil, { meta_gasto: metaGasto, meta_investimento: metaInv });
      }, 'Metas salvas');
      if (!ok) return;
      if (estado.tela === 'financas') await carregarFinancas();
      else render();
      avisarMeta();
    };
  });
}

function folhaRenda({ padrao = false } = {}) {
  const mes = estado.mes;
  const atual = padrao ? Number(estado.perfil.renda_mensal) : rendaAtual();
  const temEspecifica = !padrao && estado.rendaMes !== null;
  abrirFolha(`
    <form>
      <div class="folha-topo"><button type="button" data-fechar>Cancelar</button><h2>Renda${padrao ? ' mensal' : ''}</h2><span style="min-width:72px"></span></div>
      <div class="grupo"><div class="campo"><label for="r-valor">Valor</label><input id="r-valor" name="valor" inputmode="decimal" placeholder="R$ 0,00" value="${atual ? String(atual.toFixed(2)).replace('.', ',') : ''}" autofocus></div></div>
      <p class="dica" style="margin:0 0 14px">Quanto entra por mês (salário e outras rendas). Usado para calcular o limite por dia.</p>
      <p class="erro" hidden></p>
      ${padrao
        ? '<button class="btn-grande" type="submit" data-tipo="padrao">Salvar</button>'
        : `<button class="btn-grande" type="submit" data-tipo="padrao">Usar em todos os meses</button>
           <button class="btn-grande secundario" type="submit" data-tipo="mes">Só em ${nomeMes(mes).split(' de ')[0].toLowerCase()}</button>
           ${temEspecifica ? '<button class="link" type="button" data-voltar>Voltar a usar a renda padrão neste mês</button>' : ''}`}
    </form>`,
  (el, fechar) => {
    el.querySelector('[data-fechar]').onclick = fechar;
    el.querySelector('[data-voltar]')?.addEventListener('click', async () => {
      fechar();
      await tentar(() => api.salvarRendaDoMes(mes, null), 'Renda padrão restaurada');
      carregarFinancas();
    });
    el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const tipo = e.submitter?.dataset.tipo ?? 'padrao';
      const valor = lerValor(el.querySelector('#r-valor').value || '0');
      if (!Number.isFinite(valor) || valor < 0) {
        const erro = el.querySelector('.erro');
        erro.textContent = 'Digite um valor, por exemplo 3.500,00.';
        erro.hidden = false;
        return;
      }
      fechar();
      if (tipo === 'mes') {
        await tentar(() => api.salvarRendaDoMes(mes, valor), 'Renda do mês salva');
      } else {
        await tentar(async () => {
          await api.salvarPerfil({ renda_mensal: valor });
          estado.perfil.renda_mensal = valor;
        }, 'Renda salva');
      }
      if (estado.tela === 'financas') carregarFinancas();
      else render();
    };
  });
}

// ---------- compras automáticas (Atalho do iPhone) ----------

function folhaAutomaticas() {
  const token = estado.perfil.token_atalho;
  const texto = textoDaAutomacao(api.urlRegistrarCompra, token);
  const caminho = (t) => `<span class="caminho">${t}</span>`;
  abrirFolha(`
    <div class="folha-topo"><span style="min-width:72px"></span><h2>Compras automáticas</h2><button data-fechar>OK</button></div>
    <div class="status-atalho espera" data-status role="status"><span class="status-ponto"></span><span><strong>Conferindo…</strong><small></small></span></div>
    ${estado.perfil.atalho_antigo ? `<div class="grupo"><div class="item" style="display:block;font-weight:500;line-height:1.45">${ic.raio} <strong>Seu atalho do app antigo continua funcionando.</strong> As compras do Apple Pay continuam chegando aqui sozinhas: não precisa fazer nada. Os passos abaixo são só para um iPhone novo.</div></div>` : ''}
    <p class="dica" style="margin:0 0 14px;text-align:left">Toda compra feita com o iPhone (Apple Pay) aparece sozinha em Finanças, com uma notificação de quanto ainda dá para gastar hoje. Faça isto uma vez, neste iPhone:</p>
    <div class="grupo"><ol class="passos">
      <li><strong>Copie o texto pronto</strong>
        <p>Ele já vem com o seu código pessoal. Não mande para ninguém.</p>
        <button class="btn-pilula azul" data-copiar-texto>${ic.copiar}Copiar texto</button></li>
      <li><strong>Crie a automação</strong>
        <p>Abra o app ${caminho('Atalhos')} → ${caminho('Automação')} → ${caminho('+')} → ${caminho('Carteira')}. Deixe ${caminho('Qualquer Cartão')}, escolha ${caminho('Executar Imediatamente')} e toque em ${caminho('Seguinte')} → ${caminho('Nova Automação em Branco')}.</p></li>
      <li><strong>Cole o texto</strong>
        <p>Na caixa ${caminho('Descreva…')}, cole e envie: o Atalhos monta tudo sozinho. Confira se os campos mostram ${caminho('Valor')}, ${caminho('Comerciante')} e ${caminho('Cartão ou Tíquete')}.</p></li>
      <li><strong>Pronto</strong>
        <p>Pague algo com o iPhone. Em alguns segundos a compra aparece em Finanças e o aviso lá em cima fica verde.</p></li>
    </ol></div>
    <details class="detalhes-atalho">
      <summary>Ver o texto que vai ser copiado</summary>
      <pre class="texto-automacao">${esc(texto)}</pre>
    </details>
    <details class="detalhes-atalho">
      <summary>Seu iPhone não tem a caixa "Descreva…"? Monte à mão</summary>
      <div class="grupo"><ol class="passos">
        <li><strong>Crie a automação</strong>
          <p>${caminho('Atalhos')} → ${caminho('Automação')} → ${caminho('+')} → ${caminho('Carteira')} → ${caminho('Executar Imediatamente')} → ${caminho('Seguinte')} → ${caminho('Nova Automação em Branco')}.</p></li>
        <li><strong>Adicione "Obter Conteúdo do URL"</strong>
          <p>Cole o endereço, toque na setinha e escolha ${caminho('Método: POST')} e ${caminho('Pedir Corpo: JSON')}.</p>
          <button class="btn-pilula azul" data-copiar-url>${ic.copiar}Copiar endereço</button></li>
        <li><strong>Adicione 4 campos, todos do tipo Texto</strong>
          <p><b>valor</b> → variável ${caminho('Valor')} · <b>comerciante</b> → ${caminho('Comerciante')} · <b>cartao</b> → ${caminho('Cartão ou Tíquete')} · <b>token</b> → cole o seu código.</p>
          <button class="btn-pilula azul" data-copiar-codigo>${ic.copiar}Copiar código</button></li>
        <li><strong>Adicione "Mostrar Notificação"</strong>
          <p>Com a variável ${caminho('Conteúdos do URL')}: ela mostra se a compra entrou.</p></li>
      </ol></div>
    </details>
    <p class="dica">Compras sem o iPhone (cartão físico, internet, Pix) você lança tocando em +.</p>
    <button class="link" data-novo-codigo>Gerar um código novo</button>`,
  (el, fechar) => {
    el.querySelector('[data-fechar]').onclick = fechar;
    const copiar = async (conteudo, feito) => {
      try {
        await navigator.clipboard.writeText(conteudo);
        aviso(feito);
      } catch {
        prompt('Copie:', conteudo);
      }
    };
    el.querySelector('[data-copiar-texto]').onclick = () => copiar(texto, 'Texto copiado: agora cole no app Atalhos');
    el.querySelector('[data-copiar-url]').onclick = () => copiar(api.urlRegistrarCompra, 'Endereço copiado');
    el.querySelector('[data-copiar-codigo]').onclick = () => copiar(token, 'Código copiado');
    el.querySelector('[data-novo-codigo]').onclick = async () => {
      const sim = await confirmar({
        titulo: 'Gerar código novo?',
        texto: 'O código atual para de funcionar. Depois, copie o texto pronto de novo e refaça a automação (ou troque o código no campo token dela).',
        ok: 'Gerar',
        perigo: true,
      });
      if (!sim) return;
      await tentar(async () => { estado.perfil.token_atalho = await api.novoToken(); }, 'Código novo gerado');
      folhaAutomaticas();
    };
    // Situação da conexão: a última vez que o Atalho chamou o servidor para esta conta.
    Promise.all([
      api.ultimaTentativaAtalho().catch(() => null),
      api.temComprasAutomaticas().catch(() => false),
    ]).then(([tentativa, temCompras]) => {
      const caixa = el.querySelector('[data-status]');
      if (!caixa) return;
      const s = situacaoDoAtalho({ tentativa, temCompras });
      caixa.className = `status-atalho ${s.tom}`;
      caixa.querySelector('strong').textContent = s.titulo;
      caixa.querySelector('small').textContent = s.texto;
    });
  });
}

function folhaTrocarSenha() {
  abrirFolha(`
    <form>
      <div class="folha-topo"><button type="button" data-fechar>Cancelar</button><h2>Trocar senha</h2><button type="submit">Salvar</button></div>
      <input type="text" name="usuario" autocomplete="username" value="${esc(estado.perfil.login || estado.usuario.email)}" hidden>
      <div class="grupo">
        <div class="campo bloco"><input name="atual" type="password" autocomplete="current-password" placeholder="Senha atual" required></div>
        <div class="campo bloco"><input name="nova" type="password" minlength="6" autocomplete="new-password" placeholder="Senha nova (mínimo 6 caracteres)" required></div>
      </div>
      <p class="erro" hidden></p>
    </form>`,
  (el, fechar) => {
    el.querySelector('[data-fechar]').onclick = fechar;
    el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const erro = el.querySelector('.erro');
      if (d.nova.length < 6) {
        erro.textContent = 'A senha nova precisa ter pelo menos 6 caracteres.';
        erro.hidden = false;
        return;
      }
      const botao = el.querySelector('button[type=submit]');
      botao.disabled = true;
      try {
        await api.trocarSenha(d.nova, d.atual);
        fechar();
        aviso('Senha trocada');
      } catch (falha) {
        erro.textContent = falha.message;
        erro.hidden = false;
        botao.disabled = false;
      }
    };
  });
}

async function folhaPessoas() {
  let pessoas = [];
  let codigo = '';
  const ok = await tentar(async () => { [pessoas, codigo] = await Promise.all([api.pessoas(), api.convite()]); });
  if (!ok) return;
  const link = () => `${location.origin}${location.pathname}#convite=${codigo}`;
  abrirFolha(`
    <div class="folha-topo"><span style="min-width:72px"></span><h2>Pessoas</h2><button data-fechar>OK</button></div>
    <h3 class="grupo-titulo" style="margin-top:4px">Link de convite</h3>
    <div class="grupo"><ul class="lista">
      <li><button class="item acao" data-enviar>${ic.compartilhar}Enviar link de convite</button></li>
    </ul></div>
    <p class="dica" style="text-align:left;margin:-10px 4px 0">Só com este link dá para criar conta. A pessoa abre no Safari e escolhe o nome e a senha dela.</p>
    <h3 class="grupo-titulo">Contas</h3>
    <div class="grupo"><ul class="lista">
      ${pessoas.map((x) => `
        <li><div class="item"><span class="rotulo">${esc(x.nome || x.login || 'Sem nome')}${x.dono ? ' <span class="etiqueta">cuida do app</span>' : ''}</span>
          <button class="btn-pilula" data-nova-senha="${x.user_id}" data-nome="${esc(x.nome || x.login || '')}">Nova senha</button></div></li>`).join('')}
    </ul></div>
    <p class="dica" style="text-align:left;margin:-10px 4px 0">Alguém esqueceu a senha? Toque em Nova senha e passe para a pessoa a senha que aparecer. Ela troca depois em Ajustes.</p>
    <button class="link" data-novo-link>Trocar o link de convite</button>`,
  (el, fechar) => {
    el.querySelector('[data-fechar]').onclick = fechar;
    el.querySelector('[data-enviar]').onclick = async () => {
      const dados = { title: 'Camarada', text: 'Crie sua conta no Camarada:', url: link() };
      try {
        if (navigator.share) await navigator.share(dados);
        else { await navigator.clipboard.writeText(link()); aviso('Link copiado'); }
      } catch (e) {
        if (e?.name !== 'AbortError') prompt('Copie o link:', link());
      }
    };
    el.querySelector('[data-novo-link]').onclick = async () => {
      const sim = await confirmar({ titulo: 'Trocar o link?', texto: 'O link antigo para de funcionar. Quem já tem conta continua entrando normalmente.', ok: 'Trocar', perigo: true });
      if (!sim) return;
      await tentar(async () => { codigo = await api.convite(true); }, 'Link novo criado');
    };
    el.querySelectorAll('[data-nova-senha]').forEach((b) => {
      b.onclick = async () => {
        const nome = b.dataset.nome;
        const sim = await confirmar({ titulo: `Nova senha para ${nome}?`, texto: 'A senha atual dessa pessoa para de funcionar.', ok: 'Gerar' });
        if (!sim) return;
        let senha = '';
        if (!(await tentar(async () => { senha = await api.novaSenhaPara(b.dataset.novaSenha); }))) return;
        await confirmar({ titulo: `Senha de ${nome}`, texto: `${senha}\n\nPasse para a pessoa. Ela entra com o nome e esta senha, e troca em Ajustes → Trocar senha.`, ok: 'OK', unico: true });
      };
    });
  });
}

// ---------------------------------------------------------------- tela Ajustes

function telaAjustes() {
  const p = estado.perfil;
  const permissao = typeof Notification === 'undefined' ? 'indisponivel' : Notification.permission;
  const textoNotif = { granted: 'Ativadas', denied: 'Bloqueadas', default: 'Desativadas', indisponivel: 'Indisponíveis' }[permissao];
  return `
    <h3 class="grupo-titulo">Conta</h3>
    <div class="grupo"><ul class="lista">
      <li><div class="item"><span class="rotulo">${esc(p.nome || 'Sem nome')}</span><span class="valor-dir">${esc(p.login ? `entra como "${p.login}"` : estado.usuario.email)}</span></div></li>
      <li><button class="item" data-acao="trocar-senha"><span class="rotulo">Trocar senha</span><span class="valor-dir">›</span></button></li>
      ${p.dono ? '<li><button class="item" data-acao="pessoas"><span class="rotulo">Pessoas e convites</span><span class="valor-dir">›</span></button></li>' : ''}
    </ul></div>

    <h3 class="grupo-titulo">Camarada</h3>
    <div class="grupo"><ul class="lista">
      <li><button class="item" data-acao="recompensa"><span class="rotulo">Recompensa da semana</span><span class="valor-dir">${p.recompensa_texto ? esc(p.recompensa_texto.length > 18 ? `${p.recompensa_texto.slice(0, 17)}…` : p.recompensa_texto) : 'definir'} ›</span></button></li>
      <li><label class="item"><span class="rotulo">Bom dia do Camarada</span><input type="checkbox" class="chave" data-mudar="bom-dia" ${p.bom_dia !== false ? 'checked' : ''} aria-label="Bom dia do Camarada"></label></li>
      <li><button class="item acao" data-acao="ver-bom-dia">Ver o bom dia agora</button></li>
    </ul></div>
    <p class="dica" style="text-align:left;margin:-10px 4px 0">Todo dia, no horário dos avisos, um resumo: tarefas, quanto dá para gastar, seus pontos e um conselho.</p>

    <h3 class="grupo-titulo">Finanças</h3>
    <div class="grupo"><ul class="lista">
      <li><button class="item" data-acao="renda-padrao"><span class="rotulo">Renda mensal</span><span class="valor-dir">${formatarReal(Number(p.renda_mensal))} ›</span></button></li>
      <li><button class="item" data-acao="metas"><span class="rotulo">Metas do mês</span><span class="valor-dir">${Number(p.meta_gasto) > 0 || Number(p.meta_investimento) > 0 ? 'definidas' : 'nenhuma'} ›</span></button></li>
      <li><button class="item" data-acao="automaticas"><span class="gasto-icone auto" style="width:30px;height:30px">${ic.raio}</span><span class="rotulo">Compras automáticas</span><span class="valor-dir">›</span></button></li>
    </ul></div>
    ${estado.cartoes.length ? `
      <h3 class="grupo-titulo">Cartões de débito</h3>
      <div class="grupo"><ul class="lista">
        ${estado.cartoes.map((c) => `
          <li><label class="item"><span class="gasto-icone" style="width:30px;height:30px">${ic.cartao}</span><span class="rotulo">${esc(c.nome)}</span>
            <input type="checkbox" class="chave" data-mudar="cartao-debito" data-id="${c.id}" ${c.debito ? 'checked' : ''} aria-label="${esc(c.nome)} é de débito"></label></li>`).join('')}
      </ul></div>
      <p class="dica" style="text-align:left;margin:-10px 4px 0">Marque os cartões de débito: as compras com eles saem do salário na hora (à vista). Os outros vão para a fatura.</p>` : ''}

    <h3 class="grupo-titulo">Categorias de tarefas</h3>
    <div class="grupo"><ul class="lista">
      ${estado.categorias.map((c) => `
        <li><button class="item" data-acao="categoria" data-id="${c.id}"><span class="rotulo">${esc(c.nome)}</span><span class="valor-dir">avisar ${c.aviso_dias} ${c.aviso_dias === 1 ? 'dia' : 'dias'} antes ›</span></button></li>`).join('')}
      <li><button class="item acao" data-acao="categoria">${ic.mais}Nova categoria</button></li>
    </ul></div>
    <p class="dica" style="text-align:left;margin:-10px 4px 0">A tarefa passa para "A expirar" esse número de dias antes do prazo.</p>

    <h3 class="grupo-titulo">Notificações</h3>
    <div class="grupo"><ul class="lista">
      <li><div class="item"><span class="gasto-icone" style="width:30px;height:30px">${ic.sino}</span><span class="rotulo">Avisos de tarefas e compras</span><span class="valor-dir">${textoNotif}</span></div></li>
      ${permissao !== 'granted' ? `<li><button class="item acao" data-acao="notificacoes">Ativar notificações</button></li>` : `<li><button class="item acao" data-acao="testar-notificacao">Testar notificação</button></li>`}
      <li><label class="item" for="aj-horario"><span class="rotulo">Avisos do dia às</span>
        <select id="aj-horario" class="seletor" data-mudar="horario-aviso">
          ${Array.from({ length: 18 }, (_, i) => i + 5).map((h) => `<option value="${h}" ${Number(p.horario_aviso ?? 9) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}
        </select></label></li>
    </ul></div>
    <p class="dica" style="text-align:left;margin:-10px 4px 0">Os avisos do dia (vence amanhã, vence hoje, atrasada) chegam nesse horário. Tarefas com horário também avisam 3h, 1h e 10 min antes.</p>
    ${ehIOS && !ehStandalone ? `
      <h3 class="grupo-titulo">Instalar no iPhone</h3>
      <div class="grupo"><div class="item" style="display:block;font-weight:500">No Safari, toque em ${ic.compartilhar} <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>. As notificações só funcionam com o app instalado assim.</div></div>` : ''}

    <div class="grupo" style="margin-top:24px"><button class="item destrutivo" data-acao="sair">Sair</button></div>`;
}

function folhaCategoria(id) {
  const c = id ? estado.categorias.find((x) => x.id === id) : null;
  abrirFolha(`
    <form>
      <div class="folha-topo"><button type="button" data-fechar>Cancelar</button><h2>${c ? 'Categoria' : 'Nova categoria'}</h2><button type="submit">Salvar</button></div>
      <div class="grupo">
        <div class="campo bloco"><input name="nome" maxlength="40" placeholder="Nome (ex.: Contas)" value="${esc(c?.nome)}" required></div>
        <div class="campo"><label for="c-dias">Avisar</label><input id="c-dias" name="aviso_dias" type="number" inputmode="numeric" min="0" max="90" value="${c?.aviso_dias ?? AVISO_PADRAO}"><span style="font-weight:600">dias antes</span></div>
      </div>
      <p class="erro" hidden></p>
      ${c ? '<div class="grupo"><button type="button" class="item destrutivo" data-apagar>Apagar categoria</button></div>' : ''}
    </form>`,
  (el, fechar) => {
    el.querySelector('[data-fechar]').onclick = fechar;
    el.querySelector('[data-apagar]')?.addEventListener('click', async () => {
      const sim = await confirmar({ titulo: `Apagar "${c.nome}"?`, texto: 'As tarefas dessa categoria ficam sem categoria.', ok: 'Apagar', perigo: true });
      if (!sim) return;
      fechar();
      await tentar(() => api.apagarCategoria(id), 'Categoria apagada');
      await carregarTudo();
      render();
    });
    el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const dias = Number(d.aviso_dias);
      const erro = el.querySelector('.erro');
      if (!d.nome.trim() || !Number.isInteger(dias) || dias < 0 || dias > 90) {
        erro.textContent = 'Dê um nome e um número de dias entre 0 e 90.';
        erro.hidden = false;
        return;
      }
      fechar();
      await tentar(() => api.salvarCategoria({ id: c?.id, nome: d.nome.trim(), aviso_dias: dias }), 'Categoria salva');
      await carregarTudo();
      render();
    };
  });
}

function chaveBytes(base64) {
  const p = '='.repeat((4 - (base64.length % 4)) % 4);
  const b = atob((base64 + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function ativarNotificacoes() {
  if (ehIOS && !ehStandalone) {
    return aviso('Primeiro adicione o Camarada à Tela de Início (veja abaixo).');
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return aviso('Este navegador não aceita notificações.');
  }
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') {
    render();
    return aviso('Permissão negada. Libere em Ajustes do iPhone → Notificações → Camarada.');
  }
  if (MODO_DEMO || !CONFIG.vapidPublicKey) {
    render();
    return aviso('Notificações permitidas (o envio funciona na versão publicada).');
  }
  await tentar(async () => {
    const inscricao = await inscricaoDoAparelho(true);
    if (!inscricao) throw new Error('Não foi possível ativar agora. Feche e abra o app e tente de novo.');
    await api.salvarInscricaoPush(inscricao);
  }, 'Notificações ativadas');
  render();
}

const CHAVE_VAPID = 'camarada-vapid';
const comLimiteDe = (ms, promessa) => Promise.race([promessa, new Promise((r) => { setTimeout(() => r(null), ms); })]);

/**
 * Inscrição de notificações deste aparelho (ou null). Uma inscrição feita com outra chave
 * (ex.: a do app antigo, no iPhone que já tinha o Camarada instalado) não recebe mais nada:
 * é trocada por uma nova. Com `criar`, inscreve se ainda não estiver inscrito.
 */
async function inscricaoDoAparelho(criar = false) {
  if (!('serviceWorker' in navigator) || !CONFIG.vapidPublicKey) return null;
  const reg = await comLimiteDe(5000, navigator.serviceWorker.ready);
  if (!reg?.pushManager) return null;
  let inscricao = await reg.pushManager.getSubscription();
  if (inscricao) {
    const atual = chaveBytes(CONFIG.vapidPublicKey);
    const usada = inscricao.options?.applicationServerKey ? new Uint8Array(inscricao.options.applicationServerKey) : null;
    let marcada = null;
    try { marcada = localStorage.getItem(CHAVE_VAPID); } catch { /* sem armazenamento */ }
    const outraChave = usada ? (usada.length !== atual.length || usada.some((b, i) => b !== atual[i])) : marcada !== CONFIG.vapidPublicKey;
    if (outraChave) {
      try { await inscricao.unsubscribe(); } catch { /* já não valia */ }
      inscricao = null;
    }
  }
  if (!inscricao && criar) {
    inscricao = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBytes(CONFIG.vapidPublicKey) });
  }
  if (inscricao) try { localStorage.setItem(CHAVE_VAPID, CONFIG.vapidPublicKey); } catch { /* sem armazenamento */ }
  return inscricao;
}

/** Se a permissão já foi dada, garante que este aparelho está inscrito (a inscrição pode mudar). */
async function renovarInscricao() {
  if (MODO_DEMO || !CONFIG.vapidPublicKey || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
  try {
    const inscricao = await inscricaoDoAparelho(true);
    if (inscricao) await api.salvarInscricaoPush(inscricao);
  } catch (e) {
    console.warn('Não foi possível renovar a inscrição de notificações', e);
  }
}

// ---------------------------------------------------------------- estrutura e navegação

const TELAS = {
  hoje: { titulo: 'Hoje', icone: ic.hoje, render: telaHoje, cabecalho: () => saudacao() },
  tarefas: { titulo: 'Tarefas', icone: ic.tarefas, render: telaTarefas, novo: 'nova-tarefa' },
  financas: { titulo: 'Finanças', icone: ic.carteira, render: telaFinancas, novo: 'novo-gasto' },
  ajustes: { titulo: 'Ajustes', icone: ic.ajustes, render: telaAjustes },
};

const FORMATO_HOJE = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const dataDeHoje = () => FORMATO_HOJE.format(new Date());

function render() {
  if (!estado.iniciado) {
    raiz.innerHTML = '<div class="carregando">Carregando…</div>';
    return;
  }
  if (!estado.usuario || estado.entrada.modo === 'nova-senha') {
    raiz.innerHTML = telaEntrada();
    return;
  }
  const tela = TELAS[estado.tela];
  const rolagem = window.scrollY;
  raiz.innerHTML = `
    <div class="app">
      <header class="topo">
        ${estado.tela === 'tarefas' || estado.tela === 'hoje' ? `<p class="topo-data">${dataDeHoje()}</p>` : ''}
        <div class="topo-linha">
          <h1>${tela.cabecalho ? esc(tela.cabecalho()) : tela.titulo}</h1>
          ${tela.novo ? `<button class="btn-redondo" data-acao="${tela.novo}" aria-label="Adicionar">${ic.mais}</button>` : ''}
        </div>
      </header>
      ${MODO_DEMO ? '<p class="aviso-demo">Modo demonstração · dados de exemplo</p>' : ''}
      <main class="conteudo-tela">${tela.render()}</main>
      <nav class="barra-base" aria-label="Seções">
        ${Object.entries(TELAS).map(([id, t]) => `
          <button data-acao="tela" data-tela="${id}" ${estado.tela === id ? 'aria-current="page"' : ''}>${t.icone}${t.titulo}${id === 'financas' && estado.alertaMeta ? `<span class="ponto-alerta ${estado.alertaMeta === 100 ? 'passou' : ''}" aria-label="Meta de gastos: ${estado.alertaMeta}%"></span>` : ''}</button>`).join('')}
      </nav>
    </div>`;
  window.scrollTo(0, rolagem);
  if (estado.tela === 'tarefas') ligarArrastar();
}

function irPara(tela) {
  if (!TELAS[tela]) tela = 'hoje';
  const mudou = estado.tela !== tela;
  estado.tela = tela;
  if (location.hash !== `#${tela}`) history.replaceState(null, '', `#${tela}`);
  if (mudou) window.scrollTo(0, 0);
  render();
  if (tela === 'financas') carregarFinancas();
  if (tela === 'ajustes') carregarCartoes();
}

async function testarNotificacao() {
  await tentar(async () => {
    const enviados = await api.testarNotificacao();
    if (enviados > 0) aviso('Enviada! Deve chegar em alguns segundos.');
    else {
      await renovarInscricao();
      aviso('Este aparelho ainda não recebe avisos. Toque em "Ativar notificações" e teste de novo.');
    }
  });
}

const MUDANCAS = {
  'bom-dia': async (el) => {
    const ligado = el.checked;
    const ok = await tentar(async () => {
      await api.salvarPerfil({ bom_dia: ligado });
      estado.perfil.bom_dia = ligado;
    }, ligado ? 'Bom dia ligado' : 'Bom dia desligado');
    if (!ok) el.checked = !ligado;
  },
  'horario-aviso': async (el) => {
    const horario = Number(el.value);
    await tentar(async () => {
      await api.salvarPerfil({ horario_aviso: horario });
      estado.perfil.horario_aviso = horario;
    }, `Avisos do dia às ${String(horario).padStart(2, '0')}:00`);
  },
  'cartao-debito': async (el) => {
    const c = estado.cartoes.find((x) => x.id === el.dataset.id);
    const debito = el.checked;
    const ok = await tentar(() => api.salvarCartao(c.id, debito),
      debito ? `${c.nome}: compras saem do salário na hora` : `${c.nome}: compras vão para a fatura`);
    if (ok) c.debito = debito;
    else el.checked = !debito;
  },
};

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-mudar]');
  if (el && raiz.contains(el)) MUDANCAS[el.dataset.mudar]?.(el, e);
});

async function carregarCartoes() {
  try {
    estado.cartoes = await api.cartoes();
    if (estado.tela === 'ajustes') render();
  } catch (e) { console.warn(e); }
}

const ACOES = {
  'modo-entrada': (el) => { estado.entrada = { modo: el.dataset.modo, erro: '', ok: '' }; render(); },
  tela: (el) => irPara(el.dataset.tela),
  aba: (el) => { estado.aba = el.dataset.aba; render(); },
  'nova-tarefa': () => folhaTarefa(),
  'editar-tarefa': (el) => {
    if (el.dataset.arrastou) return;
    if (el.dataset.aberto) { el.style.transform = ''; el.dataset.aberto = ''; return; }
    folhaTarefa(el.dataset.id);
  },
  concluir: (el) => concluir(el.dataset.id),
  reabrir: (el) => reabrir(el.dataset.id),
  adiar: (el) => folhaAdiar(el.dataset.id),
  'apagar-tarefa': (el) => apagarTarefa(el.dataset.id),
  mes: (el) => {
    estado.mes = mudarMes(estado.mes, Number(el.dataset.delta));
    estado.gastos = [];
    estado.rendaMes = null;
    render();
    carregarFinancas();
  },
  renda: () => folhaRenda(),
  metas: () => folhaMetas(),
  recompensa: () => folhaRecompensa(),
  'ver-bom-dia': () => verBomDia(),
  investir: () => folhaGasto(null, 'investimento'),
  'renda-padrao': () => folhaRenda({ padrao: true }),
  'novo-gasto': () => folhaGasto(),
  'editar-gasto': (el) => folhaGasto(el.dataset.id),
  automaticas: () => folhaAutomaticas(),
  categoria: (el) => folhaCategoria(el.dataset.id),
  notificacoes: () => ativarNotificacoes(),
  'testar-notificacao': () => testarNotificacao(),
  'trocar-senha': () => folhaTrocarSenha(),
  pessoas: () => folhaPessoas(),
  sair: async () => {
    const sim = await confirmar({ titulo: 'Sair da conta?', texto: 'Este aparelho para de receber os avisos desta conta.', ok: 'Sair', perigo: true });
    if (!sim) return;
    let inscricao = null;
    try { if (!MODO_DEMO) inscricao = await inscricaoDoAparelho(false); } catch { /* sem notificações */ }
    await api.sair(inscricao);
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-acao]');
  if (!el || !raiz.contains(el)) return;
  // Botões dentro da linha não devem abrir a edição da tarefa.
  e.stopPropagation();
  ACOES[el.dataset.acao]?.(el, e);
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'form-entrada') {
    e.preventDefault();
    enviarEntrada(e.target);
  }
});

window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#convite=')) lerConvite();
  else irPara(location.hash.slice(1));
});

// Ao voltar para o app, busca o que mudou (ex.: compra registrada pelo Atalho).
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !estado.usuario) return;
  try {
    await carregarTudo();
    render();
    if (estado.tela === 'financas') carregarFinancas();
  } catch { /* sem conexão: mantém o que está na tela */ }
});

// Mensagens do service worker (ex.: notificação tocada).
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.tipo === 'abrir' && e.data.tela) irPara(e.data.tela);
});

function comLimite(promessa, ms) {
  let timer;
  const limite = new Promise((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new Error('O servidor demorou para responder. Confira sua internet.')), ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer));
}

// Uma inicialização por vez (o login e a abertura do app podem pedir ao mesmo tempo).
let inicializacao = null;
function iniciarApp() {
  inicializacao ??= executarInicio().finally(() => { inicializacao = null; });
  return inicializacao;
}

async function executarInicio() {
  try {
    estado.usuario = await comLimite(api.usuario(), 15000);
    if (estado.usuario) await comLimite(carregarTudo(), 20000);
  } catch (e) {
    console.error(e);
    raiz.innerHTML = `<div class="vazio">${ic.alerta}<strong>Não foi possível carregar</strong>${esc(e.message)}<br><br><button class="btn-grande" onclick="location.reload()">Tentar de novo</button></div>`;
    return;
  }
  estado.iniciado = true;
  if (location.hash.startsWith('#convite=')) return lerConvite();
  irPara(location.hash.slice(1) || 'hoje');
  verificarRecompensa();
  if (estado.usuario) renovarInscricao();
}

api.aoMudarSessao(async (evento, usuario) => {
  if (evento === 'PASSWORD_RECOVERY') {
    estado.usuario = usuario;
    estado.entrada = { modo: 'nova-senha', erro: '', ok: '' };
    estado.iniciado = true;
    return render();
  }
  if (evento === 'SIGNED_IN' && (!estado.usuario || estado.usuario.id !== usuario?.id)) {
    estado.aba = null;
    await iniciarApp();
  }
  if (evento === 'SIGNED_OUT') {
    Object.assign(estado, { usuario: null, perfil: null, tarefas: [], gastos: [], aba: null, entrada: { modo: 'entrar', erro: '', ok: '' } });
    try { navigator.clearAppBadge?.(); } catch { /* sem suporte */ }
    render();
  }
});

// Selo "Powered by Netlify": o Netlify o coloca fixo no canto de baixo dos sites do plano
// grátis e não deixa desligar nesse plano. Para ele não cobrir as abas, mede onde ele está e
// reserva esse espaço embaixo (--selo). Se a pessoa esconder o selo, o espaço volta ao normal.
let ultimoSelo = 0;
let seloObservado = null;
function ajustarSelo() {
  const selo = document.getElementById('nl-badge-frame');
  if (selo && selo !== seloObservado) {
    // Acabou de aparecer (com animação): acompanha de perto até ele parar no lugar.
    seloObservado = selo;
    new ResizeObserver(ajustarSelo).observe(selo);
    new MutationObserver(ajustarSelo).observe(selo, { attributes: true });
    selo.addEventListener('load', ajustarSelo);
    for (const ms of [50, 150, 300, 500, 800, 1200, 2000, 3000]) setTimeout(ajustarSelo, ms);
  }
  let altura = 0;
  if (selo) {
    const r = selo.getBoundingClientRect();
    const estilo = getComputedStyle(selo);
    const visivel = r.width > 0 && r.height > 0 && estilo.display !== 'none' && estilo.visibility !== 'hidden' && Number(estilo.opacity) > 0;
    // Aberto (cartão grande), o selo ocupa mais; mantém o espaço do selo fechado.
    if (visivel) altura = r.height < 160 ? Math.max(0, Math.round(innerHeight - r.top)) : ultimoSelo;
  }
  if (altura !== ultimoSelo) {
    ultimoSelo = altura;
    document.documentElement.style.setProperty('--selo', `${altura}px`);
  }
}
new MutationObserver(ajustarSelo).observe(document.body, { childList: true });
addEventListener('resize', ajustarSelo);
setInterval(ajustarSelo, 1000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado', e));
}

render();
iniciarApp();
