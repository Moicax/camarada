// Tela do Camarada. Tudo que muda vai primeiro para a "saída" (guardada no aparelho)
// e depois é enviado ao servidor; sem internet, fica na saída até a conexão voltar.
import { NOME_ABA, ABAS, separar, abaDe, prazoTexto, avisoDe, hojeIso, somarDias, proximaData, curta, valorEmCentavos, reais, resumoDoMes, cartaoNaLista } from './regras.js';

const $ = id => document.getElementById(id);
// Cores do sistema do iOS. As chaves ficam iguais às já guardadas nas preferências.
const CORES_APP = [['azul', '#007AFF', 'Azul'], ['verde', '#248A3D', 'Verde'], ['vinho', '#5856D6', 'Índigo'], ['laranja', '#C93400', 'Laranja'], ['grafite', '#636366', 'Grafite']];
const CORES_CAT = ['#007AFF', '#AF52DE', '#34C759', '#FF9500', '#FF3B30', '#5AC8FA', '#FF2D55', '#8E8E93'];
const REPETE = { semanal: 'toda semana', mensal: 'todo mês', anual: 'todo ano' };
const TEMAS = [['claro', 'Claro'], ['escuro', 'Escuro'], ['auto', 'Automático']];
const DIAS_CONCLUIDAS = 30;
const VAZIO = {
  pendentes: ['Nada pendente.', 'Toque em + para anotar o que não pode esquecer.'],
  expirar: ['Nada perto de vencer.', 'Tudo em dia por aqui.'],
  feitas: ['Nada concluído ainda.', 'O que você marcar como feito aparece aqui.']
};

const guardar = (chave, valor) => { try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem armazenamento: segue só na memória */ } };
const carregar = (chave, padrao) => { try { const v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; } catch { return padrao; } };
const apagarChave = chave => { try { localStorage.removeItem(chave); } catch { /* nada */ } };

const SAIDA_VAZIA = () => ({ itens: {}, categorias: {}, gastos: {}, preferencias: null });
let token = carregar('camarada-token', null);
let saida = carregar('camarada-saida', SAIDA_VAZIA());
if (!saida.gastos) saida.gastos = {};
let servidor = carregar('camarada-cache', null);
let semConexao = false;
// Notificação tocada com o app fechado: o endereço chega com #financas ou #expirar.
// Link de convite: chega com #convite=<código> e a tela de entrada abre em Criar conta.
const destinoInicial = location.hash.slice(1);
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
let convite = destinoInicial.startsWith('convite=') ? destinoInicial.slice('convite='.length) : '';
const est = {
  itens: [], categorias: [], gastos: [], preferencias: { apelido: 'Camarada', cor: 'azul', aviso_padrao: 7, tema: 'claro', renda: 0, aviso_gasto: true, debito: [] },
  aba: destinoInicial === 'expirar' ? 'expirar' : null,
  secao: destinoInicial === 'financas' ? 'financas' : destinoInicial === 'expirar' ? 'tarefas' : carregar('camarada-secao', 'tarefas'),
  mes: null,
  verAntigas: false
};

const hoje = () => hojeIso(new Date());
const agoraIso = () => new Date().toISOString();
function novoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto != null) e.textContent = texto;
  return e;
}
// Ícones de traço no estilo dos símbolos da Apple. Desenhos fixos, sem texto vindo do usuário.
const ICONES = {
  calendario: '<rect x="3" y="4.5" width="18" height="16.5" rx="3.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  alerta: '<path d="M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-2.9L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4.5M12 17.2v.1"/>',
  feito: '<circle cx="12" cy="12" r="9.5"/><path d="m7.8 12.4 2.9 2.9 5.6-6"/>',
  relogio: '<circle cx="12" cy="12" r="9.5"/><path d="M12 6.8V12l3.4 2.2"/>',
  lista: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.2 6.5h.1M4.2 12h.1M4.2 17.5h.1"/>',
  repetir: '<path d="m17 2.8 3.2 3.2L17 9.2"/><path d="M3.8 11V9.6A3.6 3.6 0 0 1 7.4 6h12.8"/><path d="m7 21.2-3.2-3.2L7 14.8"/><path d="M20.2 13v1.4a3.6 3.6 0 0 1-3.6 3.6H3.8"/>',
  lixo: '<path d="M4 6.5h16M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7M6 6.5l.9 12.6a2 2 0 0 0 2 1.9h6.2a2 2 0 0 0 2-1.9L18 6.5M10 10.5v6M14 10.5v6"/>',
  voltar: '<path d="M9 14.5 4 9.5l5-5"/><path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11"/>'
};
function icone(nome, classe = 'ic') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', classe);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONES[nome];
  return s;
}

const catsVivas = () => est.categorias.filter(c => !c.apagado).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));
const pendentesDeEnvio = () => Object.keys(saida.itens).length + Object.keys(saida.categorias).length + Object.keys(saida.gastos).length + (saida.preferencias ? 1 : 0);

/* ---------- servidor ---------- */

async function api(caminho, corpo) {
  const r = await fetch(caminho, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(dados.erro || 'Falha ' + r.status), { status: r.status });
  return dados;
}

function montarEstado() {
  const base = servidor || { itens: [], categorias: [], gastos: [], preferencias: null };
  const juntar = (lista, pendentes) => {
    const mapa = new Map(lista.map(x => [x.id, x]));
    for (const x of Object.values(pendentes)) mapa.set(x.id, x);
    return [...mapa.values()];
  };
  est.itens = juntar(base.itens, saida.itens);
  est.categorias = juntar(base.categorias, saida.categorias);
  est.gastos = juntar(base.gastos || [], saida.gastos);
  est.preferencias = saida.preferencias || base.preferencias || est.preferencias;
}

let sincronizando = null;
let deNovo = false;
async function sincronizar() {
  if (!token) return;
  if (sincronizando) { deNovo = true; return sincronizando; }
  sincronizando = (async () => {
    do {
      deNovo = false;
      const envio = { itens: Object.values(saida.itens), categorias: Object.values(saida.categorias), gastos: Object.values(saida.gastos), preferencias: saida.preferencias };
      try {
        const r = await api('/api/sincronizar', envio);
        for (const tipo of ['itens', 'categorias', 'gastos']) {
          for (const x of envio[tipo]) if (saida[tipo][x.id]?.atualizado_em === x.atualizado_em) delete saida[tipo][x.id];
        }
        if (saida.preferencias === envio.preferencias) saida.preferencias = null;
        guardar('camarada-saida', saida);
        servidor = r;
        guardar('camarada-cache', servidor);
        semConexao = false;
      } catch (e) {
        if (e.status === 401) { await encerrar(false); return; }
        semConexao = true;
        break;
      }
    } while (deNovo);
    montarEstado();
    render();
  })();
  try { await sincronizando; } finally { sincronizando = null; }
}

function mudar(tipo, lista) {
  const t = agoraIso();
  for (const x of lista) { x.atualizado_em = t; saida[tipo][x.id] = x; }
  guardar('camarada-saida', saida);
  montarEstado();
  render();
  sincronizar();
}
const salvarItens = lista => mudar('itens', lista);
const salvarCategorias = lista => mudar('categorias', lista);
const salvarGastos = lista => mudar('gastos', lista);
function salvarPreferencias(campos) {
  saida.preferencias = { ...est.preferencias, ...campos, atualizado_em: agoraIso() };
  guardar('camarada-saida', saida);
  montarEstado();
  render();
  sincronizar();
}

/* ---------- tela principal ---------- */

function saudacao() {
  const h = new Date().getHours();
  const s = h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const nome = (est.preferencias.apelido || '').trim();
  return nome ? `${s}, ${nome}` : s;
}

function aplicarCor() {
  const cor = CORES_APP.find(c => c[0] === est.preferencias.cor) || CORES_APP[0];
  document.documentElement.style.setProperty('--ac', cor[1]);
}

// Claro, escuro ou igual ao celular. Fica guardado no aparelho para a tela de senha já abrir certa.
const escuroNoCelular = matchMedia('(prefers-color-scheme: dark)');
function aplicarTema(tema) {
  const t = TEMAS.some(x => x[0] === tema) ? tema : 'claro';
  document.documentElement.dataset.tema = t;
  guardar('camarada-tema', t);
  const escuro = t === 'escuro' || (t === 'auto' && escuroNoCelular.matches);
  $('meta-tema').content = escuro ? '#000000' : '#F2F2F7';
}
aplicarTema(carregar('camarada-tema', 'claro'));
escuroNoCelular.addEventListener('change', () => aplicarTema(document.documentElement.dataset.tema));

function render() {
  if ($('tela-app').hidden) return;
  const h = hoje();
  const cats = catsVivas();
  const padrao = est.preferencias.aviso_padrao ?? 7;
  const g = separar(est.itens, h, cats, padrao);
  // A aba inicial só é escolhida quando os dados chegam: abre em A expirar se houver algo lá.
  if (!est.aba && servidor) est.aba = g.expirar.length ? 'expirar' : 'pendentes';
  const aba = est.aba || (g.expirar.length ? 'expirar' : 'pendentes');

  aplicarCor();
  aplicarTema(est.preferencias.tema || carregar('camarada-tema', 'claro'));
  $('saudacao').textContent = saudacao();
  $('data-hoje').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  for (const k of ABAS) {
    const b = $('aba-' + k);
    b.setAttribute('aria-selected', String(k === aba));
    b.tabIndex = k === aba ? 0 : -1;
    const n = b.querySelector('.n');
    // Concluídas não mostra número: só cresce e não pede nada.
    n.textContent = k === 'feitas' ? '' : g[k].length;
    n.className = 'n';
  }
  if (g.expirar.length) {
    const urgente = g.expirar.some(it => it.data_limite <= h);
    $('aba-expirar').querySelector('.n').classList.add(urgente ? 'late' : 'warn');
  }

  atualizarSelo(g.expirar.length);

  const lista = $('lista');
  lista.setAttribute('aria-labelledby', 'aba-' + aba);
  lista.replaceChildren();
  linhaAberta = null;
  let itens = g[aba];
  // Concluídas: só os últimos 30 dias; as mais antigas ficam a um toque.
  let antigas = 0;
  if (aba === 'feitas' && !est.verAntigas) {
    const limite = somarDias(h, -DIAS_CONCLUIDAS);
    const recentes = itens.filter(i => i.concluido_em >= limite);
    antigas = itens.length - recentes.length;
    itens = recentes;
  }
  if (!itens.length && !antigas) {
    const li = el('li', 'vazio');
    const nenhum = !est.itens.some(i => !i.apagado);
    const [titulo, texto] = nenhum && aba !== 'feitas' ? ['Comece por aqui.', 'Toque em + e anote a primeira coisa que não pode vencer.'] : VAZIO[aba];
    li.append(icone(aba === 'pendentes' ? 'lista' : aba === 'expirar' ? 'relogio' : 'feito', 'ic-grande'), el('b', null, titulo), texto);
    lista.append(li);
  }
  for (const it of itens) lista.append(linha(it, h, cats, padrao));
  const botaoAntigas = $('mais-antigas');
  if (botaoAntigas) botaoAntigas.remove();
  if (antigas) {
    const b = el('button', 'mais-antigas', `Mostrar ${antigas} ${antigas === 1 ? 'concluída mais antiga' : 'concluídas mais antigas'}`);
    b.type = 'button';
    b.id = 'mais-antigas';
    b.addEventListener('click', () => { est.verAntigas = true; render(); });
    lista.after(b);
  }

  // Seção da barra de baixo: Tarefas ou Finanças.
  const fin = est.secao === 'financas';
  $('vista-tarefas').hidden = fin;
  $('vista-financas').hidden = !fin;
  $('abas-tarefas').hidden = fin;
  $('sec-tarefas').setAttribute('aria-current', fin ? 'false' : 'page');
  $('sec-financas').setAttribute('aria-current', fin ? 'page' : 'false');
  $('btn-novo').setAttribute('aria-label', fin ? 'Novo gasto' : 'Nova tarefa');
  if (fin) {
    $('saudacao').textContent = 'Finanças';
    $('data-hoje').textContent = '';
    renderFinancas(h);
  }

  const pend = pendentesDeEnvio();
  const faixa = $('faixa-rede');
  faixa.hidden = !semConexao;
  faixa.textContent = pend
    ? `Sem conexão. ${pend === 1 ? '1 mudança será enviada' : pend + ' mudanças serão enviadas'} quando a internet voltar.`
    : 'Sem conexão. Mostrando a última versão salva neste aparelho.';
}

function linha(it, h, cats, padrao) {
  const feito = Boolean(it.concluido_em);
  const li = el('li', 'item' + (feito ? ' feito' : ''));
  const frente = el('div', 'frente');

  // Atrás da linha: à esquerda aparece Concluir (ou Reabrir); à direita, Adiar e Apagar.
  const esq = el('div', 'fundo fundo-esq' + (feito ? ' reabrir' : ''));
  const rotEsq = el('span');
  rotEsq.append(icone(feito ? 'voltar' : 'feito'), feito ? 'Reabrir' : 'Concluir');
  esq.append(rotEsq);
  const dir = el('div', 'fundo fundo-dir');
  if (!feito && it.data_limite) {
    const b = el('button', 'b-adiar');
    b.type = 'button';
    b.append(icone('relogio'), 'Adiar');
    b.addEventListener('click', () => adiarDaLista(it.id));
    dir.append(b);
  }
  const lixo = el('button', 'b-apagar');
  lixo.type = 'button';
  lixo.append(icone('lixo'), 'Apagar');
  lixo.addEventListener('click', () => apagarItem(it.id));
  dir.append(lixo);

  const chk = el('button', 'chk' + (feito ? ' on' : ''));
  chk.type = 'button';
  chk.setAttribute('aria-label', (feito ? 'Desfazer conclusão: ' : 'Marcar como feito: ') + it.titulo);
  chk.addEventListener('click', () => (feito ? desconcluir(it.id) : perguntarConcluir(it.id)));

  const corpo = el('button', 'item-corpo');
  corpo.type = 'button';
  corpo.addEventListener('click', () => abrirItem(it.id));
  corpo.append(el('span', 'item-titulo', it.titulo));
  // Segunda linha: prazo, categoria e o ícone de repetir. Sem data, não mostra prazo.
  const meta = el('span', 'item-meta');
  const p = prazoTexto(it, h, avisoDe(it, cats, padrao));
  if (p.texto) {
    const prazo = el('span', 'prazo' + (p.tom ? ' ' + p.tom : ''));
    prazo.append(icone(p.tom === 'late' ? 'alerta' : p.tom === 'ok' ? 'feito' : 'calendario'), p.texto);
    meta.append(prazo);
  }
  const cat = cats.find(c => c.id === it.categoria_id);
  if (cat) {
    const etiqueta = el('span', 'etiqueta');
    const ponto = el('span', 'ponto');
    ponto.style.background = cat.cor;
    etiqueta.append(ponto, cat.nome);
    meta.append(etiqueta);
  }
  if (it.recorrencia) {
    const rep = el('span', 'repete');
    rep.setAttribute('role', 'img');
    rep.setAttribute('aria-label', 'repete ' + REPETE[it.recorrencia]);
    rep.title = 'Repete ' + REPETE[it.recorrencia];
    rep.append(icone('repetir'));
    meta.append(rep);
  }
  if (meta.childNodes.length) corpo.append(meta);
  frente.append(chk, corpo);
  li.append(esq, dir, frente);
  ligarDeslize(li, frente, dir.children.length * 84, () => (feito ? desconcluir(it.id) : perguntarConcluir(it.id)));
  return li;
}

/* ---------- deslizar a tarefa para os lados, como no iPhone ---------- */

let linhaAberta = null;
function moverLinha(li, x, animar = true) {
  const f = li.querySelector('.frente');
  f.classList.toggle('arrastando', !animar);
  f.style.transform = x ? `translateX(${x}px)` : '';
  li.dataset.lado = x > 0 ? 'esq' : x < 0 ? 'dir' : '';
}
function fecharLinhaAberta(exceto) {
  if (linhaAberta && linhaAberta !== exceto) moverLinha(linhaAberta, 0);
  if (linhaAberta !== exceto) linhaAberta = null;
}
document.addEventListener('pointerdown', e => {
  if (linhaAberta && !linhaAberta.contains(e.target)) fecharLinhaAberta();
});

/* ---------- finanças ---------- */

const NOME_MES = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const DIA_CURTO = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const mesAtual = () => hoje().slice(0, 7);
function mudarMes(delta) {
  const [y, m] = (est.mes || mesAtual()).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const novo = d.toISOString().slice(0, 7);
  if (novo > mesAtual()) return;
  est.mes = novo;
  render();
}
function nomeDoDia(iso, h) {
  if (iso === h) return 'Hoje';
  if (iso === somarDias(h, -1)) return 'Ontem';
  return DIA_CURTO.format(new Date(iso + 'T12:00:00Z')).replace('.', '');
}
const ICONE_CARTAO = '<rect x="2.5" y="5" width="19" height="14.5" rx="3"/><path d="M2.5 9.8h19M6.5 15h4"/>';
const ICONE_APPLEPAY = '<path d="M8 8.5a5.5 5.5 0 0 1 0 7M11.5 6a9 9 0 0 1 0 12M15 3.8a12 12 0 0 1 0 16.4"/>';

function renderFinancas(h) {
  const mes = est.mes || mesAtual();
  const renda = est.preferencias.renda || 0;
  const r = resumoDoMes(est.gastos, mes, renda, h);
  const nomeMes = NOME_MES.format(new Date(mes + '-15T12:00:00Z'));
  $('mes-nome').textContent = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);
  $('mes-prox').disabled = mes >= mesAtual();

  const sobra = $('fin-sobra');
  if (renda) {
    $('fin-rot').textContent = r.sobra >= 0 ? 'Sobra depois de pagar o cartão' : 'Falta depois de pagar o cartão';
    sobra.textContent = reais(Math.abs(r.sobra));
    sobra.className = 'resumo-valor' + (r.sobra < 0 ? ' negativo' : '');
  } else {
    $('fin-rot').textContent = 'Gastos do mês';
    sobra.textContent = reais(r.total);
    sobra.className = 'resumo-valor neutro';
  }
  $('fin-renda').textContent = renda ? reais(renda) : 'Informar';
  const menos = (id, v) => { $(id).textContent = v ? '− ' + reais(v) : reais(0); $(id).classList.toggle('menos', v > 0); };
  menos('fin-avista', r.avista);
  menos('fin-credito', r.credito);
  $('fin-saldo').textContent = reais(r.saldo);
  $('fin-dia').textContent = renda && r.porDia !== null
    ? (r.sobra > 0 ? `Dá para gastar ${reais(r.porDia)} por dia até o fim do mês (${r.diasRestantes} ${r.diasRestantes === 1 ? 'dia' : 'dias'}).` : 'O que você recebe este mês já foi gasto.')
    : '';
  // a dica só aparece enquanto o salário não foi informado; depois, tocar no resumo continua mudando
  $('fin-dica-renda').hidden = Boolean(renda);

  // faturas do mês: só o que foi no crédito, por cartão
  $('fin-cartoes-bloco').hidden = r.porCartao.length < 1;
  const ulc = $('fin-cartoes');
  ulc.replaceChildren();
  for (const c of r.porCartao) {
    const li = el('li');
    const nome = el('span', 'nome', c.cartao);
    nome.append(el('span', 'qtd', `${c.qtd} ${c.qtd === 1 ? 'compra' : 'compras'}`));
    li.append(nome, el('span', 'total', reais(c.total)));
    ulc.append(li);
  }

  // gastos do mês, agrupados por dia
  const caixa = $('fin-gastos');
  caixa.replaceChildren();
  if (!r.doMes.length) {
    const v = el('div', 'vazio');
    v.append(icone('lista', 'ic-grande'), el('b', null, 'Nenhum gasto neste mês.'),
      mes === mesAtual() ? 'Toque em + para anotar. As compras pelo Apple Pay entram sozinhas (veja em Ajustes).' : '');
    caixa.append(v);
    return;
  }
  const porDia = new Map();
  for (const g of [...r.doMes].sort((a, b) => b.data.localeCompare(a.data) || (b.criado_em || '').localeCompare(a.criado_em || ''))) {
    if (!porDia.has(g.data)) porDia.set(g.data, []);
    porDia.get(g.data).push(g);
  }
  for (const [dia, lista] of porDia) {
    const bloco = el('section', 'dia-gastos');
    const rot = el('span', 'rotulo');
    rot.append(el('span', null, nomeDoDia(dia, h)), el('span', null, reais(lista.reduce((s, g) => s + g.valor, 0))));
    const ul = el('ul', 'lista');
    for (const g of lista) ul.append(linhaGasto(g));
    bloco.append(rot, ul);
    caixa.append(bloco);
  }
}

function linhaGasto(g) {
  const li = el('li', 'item');
  const frente = el('div', 'frente');
  const dir = el('div', 'fundo fundo-dir');
  const lixo = el('button', 'b-apagar');
  lixo.type = 'button';
  lixo.append(icone('lixo'), 'Apagar');
  lixo.addEventListener('click', () => apagarGasto(g.id));
  dir.append(lixo);

  const selo = el('span', 'selo-gasto' + (g.origem === 'applepay' ? ' applepay' : ''));
  const bola = el('span');
  const svg = icone('lista');
  svg.innerHTML = g.origem === 'applepay' ? ICONE_APPLEPAY : ICONE_CARTAO;
  bola.append(svg);
  selo.append(bola);

  const corpo = el('button', 'gasto-corpo');
  corpo.type = 'button';
  corpo.addEventListener('click', () => abrirGasto(g.id));
  corpo.append(el('span', 'item-titulo', g.descricao));
  // Crédito é o normal: só escreve quando foi à vista. O Apple Pay já aparece no ícone preto.
  const meta = [g.cartao, g.forma === 'avista' ? 'À vista' : ''].filter(Boolean).join(' · ');
  if (meta) corpo.append(el('span', 'item-meta', meta));
  frente.append(selo, corpo, el('span', 'gasto-valor', reais(g.valor)));
  li.append(dir, frente);
  ligarDeslize(li, frente, 84, null);
  return li;
}

function apagarGasto(id) {
  const g = est.gastos.find(x => x.id === id);
  if (!g) return;
  salvarGastos([{ ...g, apagado: true }]);
  avisar('Gasto apagado.', () => { const x = est.gastos.find(y => y.id === id); if (x) salvarGastos([{ ...x, apagado: false }]); });
}

/* gasto: anotar ou editar */
let editandoGasto = null;
let formaGasto = 'credito';
function marcarForma(f) {
  formaGasto = f;
  for (const b of $('gasto-forma').children) b.setAttribute('aria-checked', String(b.dataset.forma === f));
}
$('gasto-forma').addEventListener('click', e => { const b = e.target.closest('[data-forma]'); if (b) marcarForma(b.dataset.forma); });
function abrirGasto(id) {
  const g = id ? est.gastos.find(x => x.id === id) : null;
  editandoGasto = g ? g.id : null;
  $('gasto-titulo-dlg').textContent = g ? 'Editar gasto' : 'Novo gasto';
  $('gasto-valor').value = g ? reais(g.valor) : '';
  $('gasto-desc').value = g ? g.descricao : '';
  $('gasto-cartao').value = g ? g.cartao : carregar('camarada-ultimo-cartao', '');
  $('gasto-data').value = g ? g.data : hoje();
  marcarForma(g ? (g.forma === 'avista' ? 'avista' : 'credito') : carregar('camarada-ultima-forma', 'credito'));
  $('gasto-erro').textContent = '';
  $('gasto-apagar').hidden = !g;
  const cartoes = [...new Set(est.gastos.filter(x => !x.apagado && x.cartao).map(x => x.cartao))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  $('lista-cartoes').replaceChildren(...cartoes.map(c => new Option(c)));
  abrirFolha($('dlg-gasto'));
  if (!g) $('gasto-valor').focus();
}
// Escreve o valor como dinheiro enquanto digita: 1234 → R$ 12,34.
$('gasto-valor').addEventListener('input', e => mascaraDinheiro(e.target));
$('renda-valor').addEventListener('input', e => mascaraDinheiro(e.target));
function mascaraDinheiro(campo) {
  const dig = campo.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 11);
  campo.value = dig ? reais(Number(dig)) : '';
}

$('form-gasto').addEventListener('submit', e => {
  e.preventDefault();
  const valor = valorEmCentavos($('gasto-valor').value);
  if (!valor) { $('gasto-erro').textContent = 'Digite o valor do gasto.'; $('gasto-valor').focus(); return; }
  const campos = {
    valor,
    descricao: $('gasto-desc').value.trim() || 'Gasto',
    cartao: $('gasto-cartao').value.trim(),
    data: $('gasto-data').value || hoje(),
    forma: formaGasto
  };
  guardar('camarada-ultimo-cartao', campos.cartao);
  guardar('camarada-ultima-forma', formaGasto);
  $('dlg-gasto').close();
  if (editandoGasto) {
    const g = est.gastos.find(x => x.id === editandoGasto);
    if (g) salvarGastos([{ ...g, ...campos }]);
    return;
  }
  const t = agoraIso();
  est.mes = campos.data.slice(0, 7) <= mesAtual() ? campos.data.slice(0, 7) : est.mes;
  salvarGastos([{ id: novoId(), ...campos, origem: 'manual', apagado: false, criado_em: t, atualizado_em: t }]);
  avisar(`Anotado: ${reais(valor)}.`);
});
$('gasto-apagar').addEventListener('click', () => {
  if (!editandoGasto) return;
  const id = editandoGasto;
  $('dlg-gasto').close();
  apagarGasto(id);
});

/* renda e aviso a cada gasto: abre tocando no resumo ou em Ajustes › Salário do mês */
function abrirRenda() {
  const renda = est.preferencias.renda || 0;
  $('renda-valor').value = renda ? reais(renda) : '';
  $('renda-aviso').checked = est.preferencias.aviso_gasto !== false;
  abrirFolha($('dlg-renda'));
  $('renda-valor').focus();
}
$('fin-resumo').addEventListener('click', abrirRenda);
$('aj-renda').addEventListener('click', abrirRenda);
$('form-renda').addEventListener('submit', e => {
  e.preventDefault();
  $('dlg-renda').close();
  salvarPreferencias({ renda: valorEmCentavos($('renda-valor').value) || 0, aviso_gasto: $('renda-aviso').checked });
  desenharFinancasAjustes();
});

/* cartões de débito: compras do Apple Pay com eles saem do salário na hora */
function desenharFinancasAjustes() {
  const renda = est.preferencias.renda || 0;
  $('aj-renda-valor').textContent = renda ? reais(renda) : 'Informar';
  const ul = $('aj-debito');
  ul.replaceChildren();
  const debito = est.preferencias.debito || [];
  const daCarteira = est.gastos.filter(g => !g.apagado && g.origem === 'applepay' && g.cartao).map(g => g.cartao.trim());
  const nomes = [...new Map([...daCarteira, ...debito].map(n => [n.toLowerCase(), n])).values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (!nomes.length) {
    ul.append(el('li', 'vazio-cat', 'Os cartões da Carteira aparecem aqui depois da primeira compra pelo Apple Pay.'));
    return;
  }
  nomes.forEach((nome, i) => {
    const li = el('li', 'linha-debito');
    const chave = el('input', 'chave');
    chave.type = 'checkbox';
    chave.id = 'debito-' + i;
    chave.setAttribute('role', 'switch');
    chave.checked = cartaoNaLista(nome, debito);
    chave.addEventListener('change', () => marcarDebito(nome, chave.checked));
    const rotulo = el('label', 'nome', nome);
    rotulo.htmlFor = chave.id;
    li.append(rotulo, chave);
    ul.append(li);
  });
}
function marcarDebito(nome, ligado) {
  const outros = (est.preferencias.debito || []).filter(c => !cartaoNaLista(c, [nome]));
  // os gastos que já vieram do Apple Pay com esse cartão passam a contar do jeito novo
  const mudar = est.gastos.filter(g => !g.apagado && g.origem === 'applepay' && cartaoNaLista(g.cartao, [nome]) && (g.forma === 'avista') !== ligado);
  if (mudar.length) salvarGastos(mudar.map(g => ({ ...g, forma: ligado ? 'avista' : 'credito' })));
  salvarPreferencias({ debito: ligado ? [...outros, nome] : outros });
  avisar(ligado ? `${nome}: as compras saem do salário na hora.` : `${nome}: as compras vão para a fatura.`);
}

/* endereço secreto do Atalhos */
async function abrirAtalho(novo) {
  abrirFolha($('dlg-atalho'));
  const campo = $('atalho-url');
  try {
    const r = await api('/api/atalho', { novo: Boolean(novo) });
    campo.value = r.url;
    if (novo) $('atalho-res').textContent = 'Endereço trocado. Cole o novo no Atalhos; o antigo não funciona mais.';
  } catch (e) {
    campo.value = '';
    $('atalho-res').textContent = e.status ? e.message : 'Sem conexão. Abra de novo com internet.';
  }
}
$('aj-atalho').addEventListener('click', () => abrirAtalho(false));
let confirmarTroca = false;
$('atalho-novo').addEventListener('click', () => {
  if (!confirmarTroca) { confirmarTroca = true; $('atalho-novo').textContent = 'Toque de novo para trocar'; return; }
  confirmarTroca = false;
  $('atalho-novo').textContent = 'Trocar o endereço secreto';
  abrirAtalho(true);
});
$('atalho-copiar').addEventListener('click', () => {
  const campo = $('atalho-url');
  if (campo.value.startsWith('http')) copiarCampo(campo, $('atalho-res'), 'Copiado. Agora cole no Atalhos, no lugar do endereço (URL).');
});
// Copia o texto do campo; se o navegador não deixar, seleciona para copiar pelo menu.
function copiarCampo(campo, res, pronto) {
  const manual = () => { campo.focus(); campo.select(); res.textContent = 'Texto selecionado: toque em Copiar no menu que aparecer.'; };
  try { navigator.clipboard.writeText(campo.value).then(() => { res.textContent = pronto; }, manual); } catch { manual(); }
}

function ligarDeslize(li, frente, larguraBotoes, acaoDireita) {
  const ATIVAR = 90;
  let x0 = null;
  let y0 = 0;
  let base = 0;
  let dx = 0;
  let modo = null;
  let arrastou = false;
  frente.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    x0 = e.clientX;
    y0 = e.clientY;
    dx = 0;
    modo = null;
    arrastou = false;
    base = linhaAberta === li ? -larguraBotoes : 0;
    fecharLinhaAberta(li);
  });
  frente.addEventListener('pointermove', e => {
    if (x0 === null) return;
    const mx = e.clientX - x0;
    const my = e.clientY - y0;
    if (!modo) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      modo = Math.abs(mx) > Math.abs(my) ? 'lado' : 'rolar';
      if (modo === 'lado') { arrastou = true; frente.setPointerCapture(e.pointerId); }
    }
    if (modo !== 'lado') return;
    dx = base + mx;
    if (!acaoDireita && dx > 0) dx = 0;
    // passou do fim dos botões: segue o dedo mais devagar, como uma mola
    const x = dx < -larguraBotoes ? -larguraBotoes + (dx + larguraBotoes) / 3 : Math.min(dx, li.clientWidth * 0.55);
    moverLinha(li, x, false);
  });
  const soltar = () => {
    if (x0 === null) return;
    x0 = null;
    if (modo !== 'lado') return;
    if (dx > ATIVAR && acaoDireita) { moverLinha(li, 0); linhaAberta = null; acaoDireita(); }
    else if (dx < -larguraBotoes / 2) { moverLinha(li, -larguraBotoes); linhaAberta = li; }
    else { moverLinha(li, 0); if (linhaAberta === li) linhaAberta = null; }
  };
  frente.addEventListener('pointerup', soltar);
  frente.addEventListener('pointercancel', () => { x0 = null; moverLinha(li, linhaAberta === li ? -larguraBotoes : 0); });
  // Depois de arrastar, o toque não abre a tarefa. Com a linha aberta, um toque só fecha.
  frente.addEventListener('click', e => {
    if (!arrastou && !base) return;
    e.stopPropagation();
    e.preventDefault();
    if (!arrastou) { moverLinha(li, 0); linhaAberta = null; }
  }, true);
}

/* ---------- adiar o prazo ---------- */

let aoAdiar = null;
function dataAdiada(iso, opcao) {
  const base = iso > hoje() ? iso : hoje();
  return opcao === 'mes' ? proximaData(base, 'mensal') : somarDias(base, Number(opcao));
}
function abrirAdiar(titulo, dataAtual, escolher) {
  aoAdiar = escolher;
  $('adiar-item').textContent = titulo;
  const fmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  for (const b of $('dlg-adiar').querySelectorAll('[data-adiar]')) {
    const nova = dataAdiada(dataAtual, b.dataset.adiar);
    b.querySelector('small').textContent = 'até ' + fmt.format(new Date(nova + 'T12:00:00Z')).replace('.', '');
  }
  abrirFolha($('dlg-adiar'));
}
$('dlg-adiar').addEventListener('click', e => {
  const b = e.target.closest('[data-adiar]');
  if (!b || !aoAdiar) return;
  const escolher = aoAdiar;
  aoAdiar = null;
  $('dlg-adiar').close();
  escolher(b.dataset.adiar);
});

function adiarDaLista(id) {
  const it = acharItem(id);
  if (!it || !it.data_limite) return;
  fecharLinhaAberta();
  abrirAdiar(it.titulo, it.data_limite, opcao => {
    const atual = acharItem(id);
    if (!atual) return;
    const antes = atual.data_limite;
    const novo = { ...atual, data_limite: dataAdiada(antes, opcao) };
    salvarItens([novo]);
    const aba = abaDoItem(novo);
    avisar(`Adiado para ${curta(novo.data_limite)}${aba !== 'expirar' ? '. Foi para ' + NOME_ABA[aba] : ''}.`, () => {
      const x = acharItem(id);
      if (x) salvarItens([{ ...x, data_limite: antes }]);
    });
  });
}

/* ---------- número no ícone do app ---------- */

function atualizarSelo(n) {
  if (!('setAppBadge' in navigator)) return;
  try { (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch { /* sem número no ícone */ }
}

/* ---------- ações nos itens ---------- */

function criarItem(campos) {
  const t = agoraIso();
  return {
    id: novoId(), titulo: '', categoria_id: null, data_limite: null, hora: null, aviso_dias: null, recorrencia: null,
    dia_original: null, concluido_em: null, proximo_id: null, gerado_de: null, notas: '', apagado: false,
    criado_em: t, atualizado_em: t, ...campos
  };
}

const acharItem = id => est.itens.find(x => x.id === id);
const abaDoItem = it => abaDe(it, hoje(), catsVivas(), est.preferencias.aviso_padrao ?? 7);

function concluir(id) {
  const it = acharItem(id);
  if (!it) return;
  const feito = { ...it, concluido_em: hoje() };
  const lista = [feito];
  let msg = 'Feito: ' + it.titulo + '.';
  if (it.recorrencia && it.data_limite) {
    const dia = it.dia_original || Number(it.data_limite.slice(8));
    const prox = criarItem({
      titulo: it.titulo, categoria_id: it.categoria_id, recorrencia: it.recorrencia, aviso_dias: it.aviso_dias, hora: it.hora || null,
      notas: it.notas, dia_original: dia, gerado_de: it.id, data_limite: proximaData(it.data_limite, it.recorrencia, dia)
    });
    feito.proximo_id = prox.id;
    lista.push(prox);
    msg = `Feito. O próximo fica para ${curta(prox.data_limite)}.`;
  }
  salvarItens(lista);
  avisar(msg, () => desconcluir(id, true));
}

// Pergunta antes de concluir, para um toque sem querer não tirar a tarefa da lista.
let paraConcluir = null;
function perguntarConcluir(id) {
  const it = acharItem(id);
  if (!it) return;
  paraConcluir = id;
  $('conc-item').textContent = it.titulo;
  const prox = it.recorrencia && it.data_limite
    ? proximaData(it.data_limite, it.recorrencia, it.dia_original || Number(it.data_limite.slice(8)))
    : null;
  $('conc-prox').hidden = !prox;
  $('conc-prox').textContent = prox ? `Como ela repete, a próxima fica para ${curta(prox)}.` : '';
  abrirFolha($('dlg-concluir'));
  $('conc-sim').focus();
}
$('conc-sim').addEventListener('click', () => {
  const id = paraConcluir;
  paraConcluir = null;
  $('dlg-concluir').close();
  if (id) concluir(id);
});

function desconcluir(id, silencioso) {
  const it = acharItem(id);
  if (!it) return;
  const volta = { ...it, concluido_em: null, proximo_id: null };
  const lista = [volta];
  const prox = it.proximo_id && acharItem(it.proximo_id);
  if (prox && !prox.concluido_em && !prox.apagado) lista.push({ ...prox, apagado: true });
  salvarItens(lista);
  if (!silencioso) avisar('Voltou para ' + NOME_ABA[abaDoItem(volta)] + '.');
}

function apagarItem(id) {
  const it = acharItem(id);
  if (!it) return;
  salvarItens([{ ...it, apagado: true }]);
  avisar('Tarefa apagada.', () => { const x = acharItem(id); if (x) salvarItens([{ ...x, apagado: false }]); });
}

/* ---------- aviso rápido (toast) ---------- */

let tempoToast;
function esconderToast() { $('toast').hidden = true; }
function avisar(msg, desfazer) {
  $('toast-texto').textContent = msg;
  const b = $('toast-acao');
  b.hidden = !desfazer;
  b.onclick = desfazer ? () => { esconderToast(); desfazer(); } : null;
  $('toast').hidden = false;
  clearTimeout(tempoToast);
  tempoToast = setTimeout(esconderToast, desfazer ? 6000 : 3500);
}

/* ---------- folhas (janelas) ---------- */

function abrirFolha(dlg) {
  if (!dlg.open) dlg.showModal();
}
document.querySelectorAll('dialog').forEach(dlg => {
  dlg.addEventListener('click', e => {
    if (e.target.closest('[data-fechar]')) { dlg.close(); return; }
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) dlg.close();
  });
});

function preencherCategorias(select, escolhida) {
  select.replaceChildren(new Option('Sem categoria', ''));
  for (const c of catsVivas()) select.append(new Option(c.nome, c.id));
  select.value = escolhida && catsVivas().some(c => c.id === escolhida) ? escolhida : '';
}

/* item */
let editando = null;
let ultimaCategoria = carregar('camarada-ultima-cat', '');

function abrirItem(id) {
  const it = id ? acharItem(id) : null;
  editando = it ? it.id : null;
  $('item-titulo-dlg').textContent = it ? 'Editar tarefa' : 'Nova tarefa';
  $('item-titulo').value = it ? it.titulo : '';
  $('item-data').value = it?.data_limite || '';
  $('item-hora').value = it?.hora || '';
  preencherCategorias($('item-categoria'), it ? it.categoria_id : (est.aba === 'feitas' ? '' : ultimaCategoria));
  $('item-repetir').value = it?.recorrencia || '';
  $('item-notas').value = it?.notas || '';
  $('item-mais').open = Boolean(it && (it.recorrencia || it.notas));
  $('item-erro').textContent = '';
  $('item-apagar').hidden = !it;
  $('item-adiar').hidden = !(it && !it.concluido_em && it.data_limite);
  marcarChip();
  abrirFolha($('dlg-item'));
  if (!it) $('item-titulo').focus();
}

function marcarChip() {
  const v = $('item-data').value;
  const h = hoje();
  for (const b of $('chips-data').children) {
    const d = b.dataset.dias;
    b.classList.toggle('ativo', d === '' ? !v : v === somarDias(h, Number(d)));
  }
}

$('chips-data').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  $('item-data').value = b.dataset.dias === '' ? '' : somarDias(hoje(), Number(b.dataset.dias));
  if (b.dataset.dias === '') $('item-hora').value = '';
  marcarChip();
});
$('item-data').addEventListener('input', marcarChip);

$('form-item').addEventListener('submit', e => {
  e.preventDefault();
  const titulo = $('item-titulo').value.trim();
  if (!titulo) { $('item-erro').textContent = 'Escreva o que precisa fazer.'; $('item-titulo').focus(); return; }
  const hora = $('item-hora').value || null;
  // hora sem data vale para hoje
  const data = $('item-data').value || (hora ? hoje() : null);
  const recorrencia = $('item-repetir').value || null;
  // O aviso vem da categoria (ou do padrão em Ajustes); um valor antigo da tarefa é mantido.
  const campos = {
    titulo, data_limite: data, hora, categoria_id: $('item-categoria').value || null, recorrencia,
    notas: $('item-notas').value.trim(), dia_original: recorrencia && data ? Number(data.slice(8)) : null
  };
  $('dlg-item').close();
  if (editando) {
    const it = acharItem(editando);
    if (it) salvarItens([{ ...it, ...campos }]);
    return;
  }
  const novo = criarItem(campos);
  ultimaCategoria = campos.categoria_id || '';
  guardar('camarada-ultima-cat', ultimaCategoria);
  est.aba = abaDoItem(novo);
  salvarItens([novo]);
  avisar('Anotado em ' + NOME_ABA[est.aba] + '.');
});

// No editor, adiar só muda a data do campo; vale quando tocar em Salvar.
$('item-adiar').addEventListener('click', () => {
  const titulo = $('item-titulo').value.trim() || 'Tarefa';
  abrirAdiar(titulo, $('item-data').value || hoje(), opcao => {
    $('item-data').value = dataAdiada($('item-data').value || hoje(), opcao);
    marcarChip();
  });
});

$('item-apagar').addEventListener('click', () => {
  if (!editando) return;
  const id = editando;
  $('dlg-item').close();
  apagarItem(id);
});

/* categoria */
let editandoCat = null;
let catVeioDoItem = false;
let corCat = CORES_CAT[0];
let confirmarCat = null;

function desenharCores(caixa, cores, atual, aoEscolher) {
  caixa.replaceChildren();
  for (const [valor, hex, nome] of cores) {
    const b = el('button', 'cor');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(valor === atual));
    b.setAttribute('aria-label', nome);
    b.style.background = hex;
    b.addEventListener('click', () => { aoEscolher(valor); desenharCores(caixa, cores, valor, aoEscolher); });
    caixa.append(b);
  }
}
const coresCategoria = () => CORES_CAT.map((hex, i) => [hex, hex, 'Cor ' + (i + 1)]);

function abrirCategoria(id, doItem) {
  const c = id ? est.categorias.find(x => x.id === id) : null;
  editandoCat = c ? c.id : null;
  catVeioDoItem = Boolean(doItem);
  $('cat-titulo-dlg').textContent = c ? 'Editar categoria' : 'Nova categoria';
  $('cat-nome').value = c ? c.nome : '';
  $('cat-aviso').value = c ? c.aviso_dias : 7;
  $('cat-erro').textContent = '';
  const usadas = new Set(catsVivas().map(x => x.cor));
  corCat = c ? c.cor : (CORES_CAT.find(x => !usadas.has(x)) || CORES_CAT[0]);
  desenharCores($('cat-cores'), coresCategoria(), corCat, v => { corCat = v; });
  $('cat-apagar').hidden = !c;
  $('cat-apagar').textContent = 'Apagar categoria';
  confirmarCat = null;
  abrirFolha($('dlg-cat'));
  if (!c) $('cat-nome').focus();
}

$('form-cat').addEventListener('submit', e => {
  e.preventDefault();
  const nome = $('cat-nome').value.trim();
  if (!nome) { $('cat-erro').textContent = 'Dê um nome para a categoria.'; $('cat-nome').focus(); return; }
  const aviso = Math.min(365, Math.max(0, parseInt($('cat-aviso').value, 10) || 0));
  let cat;
  if (editandoCat) cat = { ...est.categorias.find(x => x.id === editandoCat), nome, cor: corCat, aviso_dias: aviso };
  else cat = { id: novoId(), nome, cor: corCat, aviso_dias: aviso, ordem: catsVivas().length, apagado: false, atualizado_em: agoraIso() };
  $('dlg-cat').close();
  salvarCategorias([cat]);
  if (catVeioDoItem) preencherCategorias($('item-categoria'), cat.id);
  desenharCategoriasAjustes();
});

$('cat-apagar').addEventListener('click', () => {
  if (!editandoCat) return;
  const c = est.categorias.find(x => x.id === editandoCat);
  const usam = est.itens.filter(i => !i.apagado && i.categoria_id === editandoCat).length;
  if (confirmarCat !== editandoCat) {
    confirmarCat = editandoCat;
    $('cat-apagar').textContent = usam ? `Toque de novo: ${usam} ${usam === 1 ? 'tarefa fica' : 'tarefas ficam'} sem categoria` : 'Toque de novo para apagar';
    return;
  }
  $('dlg-cat').close();
  salvarCategorias([{ ...c, apagado: true }]);
  desenharCategoriasAjustes();
  avisar('Categoria apagada.', () => {
    const x = est.categorias.find(y => y.id === c.id);
    if (x) { salvarCategorias([{ ...x, apagado: false }]); desenharCategoriasAjustes(); }
  });
});

$('item-nova-cat').addEventListener('click', () => abrirCategoria(null, true));

/* ajustes */
function desenharCategoriasAjustes() {
  const ul = $('aj-cats');
  ul.replaceChildren();
  const cats = catsVivas();
  if (!cats.length) { ul.append(el('li', 'vazio-cat', 'Nenhuma categoria. Toque em Nova categoria.')); return; }
  for (const c of cats) {
    const li = el('li');
    const b = el('button');
    b.type = 'button';
    const p = el('span', 'ponto');
    p.style.background = c.cor;
    b.append(p, el('span', 'nome', c.nome), el('span', 'dias', `avisa ${c.aviso_dias} ${c.aviso_dias === 1 ? 'dia' : 'dias'} antes`));
    b.addEventListener('click', () => abrirCategoria(c.id, false));
    li.append(b);
    ul.append(li);
  }
}

function desenharTema() {
  const caixa = $('aj-tema');
  const atual = est.preferencias.tema || carregar('camarada-tema', 'claro');
  caixa.replaceChildren();
  for (const [valor, nome] of TEMAS) {
    const b = el('button', null, nome);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(valor === atual));
    b.addEventListener('click', () => { salvarPreferencias({ tema: valor }); desenharTema(); });
    caixa.append(b);
  }
}

let confirmarSair = false;
let tempoApelido;
function abrirAjustes() {
  $('aj-apelido').value = est.preferencias.apelido || '';
  $('aj-aviso').value = est.preferencias.aviso_padrao ?? 7;
  desenharCores($('aj-cores'), CORES_APP, est.preferencias.cor || 'azul', v => salvarPreferencias({ cor: v }));
  desenharTema();
  desenharCategoriasAjustes();
  desenharFinancasAjustes();
  $('aj-horario').value = String(est.preferencias.horario ?? 7);
  $('aj-teste-res').textContent = '';
  estadoPush();
  desenharConta();
  $('aj-instalar').hidden = !(ehIphone() && !instalado());
  $('aj-sair').textContent = 'Sair deste aparelho';
  confirmarSair = false;
  abrirFolha($('dlg-ajustes'));
}

$('aj-apelido').addEventListener('input', () => {
  clearTimeout(tempoApelido);
  tempoApelido = setTimeout(() => salvarPreferencias({ apelido: $('aj-apelido').value.trim() }), 500);
});
$('aj-aviso').addEventListener('change', () => {
  const v = Math.min(365, Math.max(0, parseInt($('aj-aviso').value, 10) || 0));
  $('aj-aviso').value = v;
  salvarPreferencias({ aviso_padrao: v });
});
$('aj-nova-cat').addEventListener('click', () => abrirCategoria(null, false));

/* avisos: notificação neste celular e horário */
for (let h = 5; h <= 22; h++) $('aj-horario').append(new Option(String(h).padStart(2, '0') + ':00', String(h)));
$('aj-horario').addEventListener('change', () => salvarPreferencias({ horario: Number($('aj-horario').value) }));

const suportaPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let inscricaoAtual = null;

async function estadoPush() {
  const nota = $('aj-push-estado');
  const botao = $('aj-push');
  botao.hidden = true;
  if (!suportaPush()) {
    nota.textContent = ehIphone() && !instalado()
      ? 'Para receber notificações no iPhone, adicione o Camarada à Tela de Início (veja abaixo) e abra pelo ícone.'
      : 'Este navegador não recebe notificações. Use o Camarada no celular para receber os avisos.';
    return;
  }
  if (Notification.permission === 'denied') {
    nota.textContent = ehIphone()
      ? 'As notificações estão bloqueadas. Libere em Ajustes do iPhone › Notificações › Camarada.'
      : 'As notificações estão bloqueadas neste navegador. Libere nas configurações do navegador.';
    return;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    inscricaoAtual = reg ? await reg.pushManager.getSubscription() : null;
  } catch { inscricaoAtual = null; }
  botao.hidden = false;
  botao.textContent = inscricaoAtual ? 'Desativar' : 'Ativar';
  nota.textContent = inscricaoAtual ? 'Ativadas. Os avisos chegam neste celular.' : 'Desativadas. Toque em Ativar para receber os avisos aqui.';
}

function chaveParaBytes(base64url) {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - base64url.length % 4) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

$('aj-push').addEventListener('click', async () => {
  const nota = $('aj-push-estado');
  const botao = $('aj-push');
  botao.disabled = true;
  try {
    if (inscricaoAtual) {
      const endpoint = inscricaoAtual.endpoint;
      await inscricaoAtual.unsubscribe();
      await api('/api/push-cancelar', { endpoint }).catch(() => {});
    } else {
      // O pedido de permissão vem primeiro: o iPhone só mostra a pergunta logo depois do toque.
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') { await estadoPush(); return; }
      const reg = await navigator.serviceWorker.ready;
      const { chave } = await api('/api/push-chave');
      const insc = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(chave) });
      await api('/api/push-inscrever', { inscricao: insc.toJSON() });
    }
    await estadoPush();
  } catch (e) {
    nota.textContent = e.status ? e.message : 'Não deu para ativar agora. Confira a internet e tente de novo.';
  } finally {
    botao.disabled = false;
  }
});

const TEXTO_RESULTADO = r => (r === 'ok' ? 'enviado' : r);
$('aj-teste').addEventListener('click', async () => {
  const b = $('aj-teste');
  const res = $('aj-teste-res');
  b.disabled = true;
  res.textContent = 'Enviando…';
  try {
    await sincronizar();
    const r = await api('/api/avisos-teste', {});
    res.textContent = r.push === 'ok' ? 'Notificação enviada. Deve chegar em alguns segundos.' : `Notificação: ${TEXTO_RESULTADO(r.push)}.`;
  } catch (e) {
    res.textContent = e.status ? e.message : 'Sem conexão. Tente de novo.';
  } finally {
    b.disabled = false;
  }
});
$('aj-sair').addEventListener('click', async () => {
  if (!confirmarSair) {
    confirmarSair = true;
    $('aj-sair').textContent = pendentesDeEnvio() ? 'Há mudanças não enviadas. Toque de novo para sair mesmo assim' : 'Toque de novo para sair';
    return;
  }
  $('dlg-ajustes').close();
  await encerrar(true);
});

/* conta: trocar a senha e, para quem cuida do app, as pessoas e o convite */
function desenharConta() {
  const conta = servidor?.conta;
  $('aj-conta-nome').textContent = conta ? `Para entrar em outro aparelho, use o nome ${conta.nome} e a sua senha.` : '';
  $('aj-pessoas-linha').hidden = !conta?.dono;
}

$('aj-senha').addEventListener('click', () => {
  $('senha-conta').value = servidor?.conta?.nome || '';
  $('senha-atual').value = '';
  $('senha-nova').value = '';
  $('senha-erro').textContent = '';
  abrirFolha($('dlg-senha'));
  $('senha-atual').focus();
});
$('form-senha').addEventListener('submit', async e => {
  e.preventDefault();
  const atual = $('senha-atual').value;
  const nova = $('senha-nova').value;
  if (!atual) { $('senha-erro').textContent = 'Digite a senha atual.'; $('senha-atual').focus(); return; }
  if (nova.length < 6) { $('senha-erro').textContent = 'A senha nova precisa ter pelo menos 6 caracteres.'; $('senha-nova').focus(); return; }
  try {
    await api('/api/senha', { atual, nova });
    $('dlg-senha').close();
    avisar('Senha trocada.');
  } catch (erro) {
    $('senha-erro').textContent = erro.status ? erro.message : 'Sem conexão. Tente de novo com internet.';
  }
});

const DATA_CURTA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const DICA_CONVITE = $('convite-res').textContent;
const DICA_PESSOAS = $('pessoas-res').textContent;
async function abrirPessoas(novoConvite) {
  if (!novoConvite) {
    $('convite-url').value = 'Carregando…';
    $('convite-res').textContent = DICA_CONVITE;
    $('pessoas-res').textContent = DICA_PESSOAS;
    confirmarConvite = false;
    $('convite-novo').textContent = 'Trocar o link de convite';
  }
  abrirFolha($('dlg-pessoas'));
  $('convite-enviar').textContent = navigator.share ? 'Enviar' : 'Copiar';
  try {
    desenharPessoas(await api('/api/pessoas', novoConvite ? { novo_convite: true } : {}));
    if (novoConvite) $('convite-res').textContent = 'Link trocado. O antigo não funciona mais.';
  } catch (e) {
    $('convite-url').value = '';
    $('convite-res').textContent = e.status ? e.message : 'Sem conexão. Abra de novo com internet.';
  }
}
function desenharPessoas({ pessoas, convite: link }) {
  $('convite-url').value = link;
  const ul = $('pessoas-lista');
  ul.replaceChildren();
  for (const p of pessoas) {
    const li = el('li', 'linha-pessoa');
    const nome = el('span', 'nome', p.nome);
    nome.append(el('span', 'qtd', p.voce ? 'você' : 'desde ' + DATA_CURTA.format(new Date(p.desde + 'T12:00:00Z'))));
    li.append(nome);
    if (!p.voce) {
      // dois toques, para não trocar a senha de alguém sem querer
      const b = el('button', null, 'Nova senha');
      b.type = 'button';
      b.addEventListener('click', async () => {
        if (b.dataset.confirmar !== 'sim') { b.dataset.confirmar = 'sim'; b.textContent = 'Confirmar'; return; }
        b.disabled = true;
        try {
          const { senha } = await api('/api/pessoas/senha', { nome: p.nome });
          $('pessoas-res').textContent = `Senha nova de ${p.nome}: ${senha}. Passe para a pessoa; ela troca depois em Ajustes › Trocar senha.`;
          b.textContent = 'Feito';
        } catch (e) {
          $('pessoas-res').textContent = e.status ? e.message : 'Sem conexão. Tente de novo.';
          b.disabled = false;
          b.textContent = 'Nova senha';
          delete b.dataset.confirmar;
        }
      });
      li.append(b);
    }
    ul.append(li);
  }
}
$('aj-pessoas').addEventListener('click', () => abrirPessoas(false));
$('convite-enviar').addEventListener('click', async () => {
  const campo = $('convite-url');
  if (!campo.value.startsWith('http')) return;
  if (navigator.share) {
    try { await navigator.share({ title: 'Camarada', text: 'Crie sua conta no Camarada (abra no Safari):', url: campo.value }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  copiarCampo(campo, $('convite-res'), 'Link copiado. Cole numa mensagem para a pessoa.');
});
let confirmarConvite = false;
$('convite-novo').addEventListener('click', () => {
  if (!confirmarConvite) { confirmarConvite = true; $('convite-novo').textContent = 'Toque de novo para trocar'; return; }
  confirmarConvite = false;
  $('convite-novo').textContent = 'Trocar o link de convite';
  abrirPessoas(true);
});

/* ---------- entrada: nome e senha ---------- */

let criando = false;
let primeiraConta = false;

async function mostrarEntrada(mensagem) {
  $('tela-app').hidden = true;
  $('tela-entrada').hidden = false;
  $('senha').value = '';
  $('entrada-erro').textContent = '';
  $('entrada-trocar').hidden = true;
  $('entrada-texto').textContent = 'Carregando…';
  try {
    primeiraConta = (await api('/api/estado')).primeira === true;
  } catch {
    $('entrada-texto').textContent = 'Sem conexão. Confira a internet e abra de novo.';
    return;
  }
  modoEntrada(primeiraConta || Boolean(convite));
  $('entrada-erro').textContent = mensagem || '';
}

function modoEntrada(criar) {
  criando = criar;
  $('entrada-texto').textContent = !criar
    ? 'Digite seu nome e sua senha. Este aparelho vai lembrar de você.'
    : primeiraConta
      ? 'Crie a primeira conta. Depois, em Ajustes, você pode convidar outras pessoas.'
      : 'Crie sua conta. Para entrar depois, é só digitar o seu nome e esta senha.';
  $('senha').autocomplete = criar ? 'new-password' : 'current-password';
  $('btn-entrar').textContent = criar ? 'Criar conta' : 'Entrar';
  // com o convite dá para alternar: quem já criou a conta só quer entrar
  $('entrada-trocar').hidden = primeiraConta || !convite;
  $('entrada-trocar').textContent = criar ? 'Já tenho conta' : 'Criar conta com o convite';
  $('entrada-erro').textContent = '';
  $('nome').focus();
}
$('entrada-trocar').addEventListener('click', () => modoEntrada(!criando));

$('mostrar-senha').addEventListener('change', e => { $('senha').type = e.target.checked ? 'text' : 'password'; });

$('form-entrada').addEventListener('submit', async e => {
  e.preventDefault();
  const nome = $('nome').value.trim();
  const senha = $('senha').value;
  const erro = msg => { $('entrada-erro').textContent = msg; };
  if (!nome) { erro('Digite o seu nome.'); $('nome').focus(); return; }
  if (criando && senha.length < 6) { erro('Use pelo menos 6 caracteres na senha.'); $('senha').focus(); return; }
  if (!senha) { erro('Digite a senha.'); $('senha').focus(); return; }
  $('btn-entrar').disabled = true;
  try {
    const r = await api(criando ? '/api/criar-conta' : '/api/entrar', criando ? { nome, senha, convite } : { nome, senha });
    token = r.token;
    guardar('camarada-token', token);
    convite = ''; // já usado: se sair depois, a tela volta em Entrar
    servidor = null;
    saida = SAIDA_VAZIA();
    guardar('camarada-saida', saida);
    $('nome').value = '';
    $('senha').value = '';
    mostrarApp();
  } catch (falha) {
    erro(falha.status ? falha.message : 'Sem conexão. Confira a internet e tente de novo.');
  } finally {
    $('btn-entrar').disabled = false;
  }
});

// As notificações deste aparelho eram da conta que saiu: desliga, para não avisar a próxima pessoa.
async function desligarPushDoAparelho() {
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    const insc = reg?.pushManager ? await reg.pushManager.getSubscription() : null;
    if (!insc) return null;
    await insc.unsubscribe();
    return insc.endpoint;
  } catch { return null; }
}

async function encerrar(avisarServidor) {
  const endpoint = await desligarPushDoAparelho();
  if (avisarServidor) {
    try {
      if (endpoint) await api('/api/push-cancelar', { endpoint });
      await api('/api/sair', {});
    } catch { /* sai mesmo sem internet */ }
  }
  token = null;
  servidor = null;
  saida = SAIDA_VAZIA();
  est.aba = null;
  ultimaCategoria = '';
  // o que é da pessoa sai do aparelho; o tema fica, porque é do aparelho
  ['camarada-token', 'camarada-cache', 'camarada-saida', 'camarada-ultimo-cartao', 'camarada-ultima-forma', 'camarada-ultima-cat', 'camarada-secao'].forEach(apagarChave);
  atualizarSelo(0);
  mostrarEntrada(avisarServidor ? '' : 'Sua entrada expirou. Digite seu nome e sua senha de novo.');
}

/* ---------- início ---------- */

const ehIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalado = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

function mostrarApp() {
  $('tela-entrada').hidden = true;
  $('tela-app').hidden = false;
  $('dica-instalar').hidden = !(ehIphone() && !instalado() && !carregar('camarada-dica-fechada', false));
  montarEstado();
  render();
  sincronizar().then(dicaDeslizar);
}

// Uma vez só: ensina que dá para deslizar a tarefa.
function dicaDeslizar() {
  if (carregar('camarada-dica-deslizar', false) || !est.itens.some(i => !i.apagado)) return;
  guardar('camarada-dica-deslizar', true);
  avisar('Dica: deslize uma tarefa para a direita para concluir, ou para a esquerda para adiar ou apagar.');
}

for (const k of ABAS) {
  $('aba-' + k).addEventListener('click', () => { est.aba = k; est.verAntigas = false; render(); window.scrollTo({ top: 0 }); });
}
$('aba-pendentes').parentElement.addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const i = ABAS.indexOf(est.aba);
  est.aba = ABAS[(i + (e.key === 'ArrowRight' ? 1 : ABAS.length - 1)) % ABAS.length];
  render();
  $('aba-' + est.aba).focus();
});
$('btn-novo').addEventListener('click', () => (est.secao === 'financas' ? abrirGasto(null) : abrirItem(null)));
for (const b of document.querySelectorAll('.secao')) {
  b.addEventListener('click', () => {
    est.secao = b.dataset.secao;
    guardar('camarada-secao', est.secao);
    if (est.secao === 'financas') est.mes = null;
    render();
    window.scrollTo({ top: 0 });
  });
}
$('mes-ant').addEventListener('click', () => mudarMes(-1));
$('mes-prox').addEventListener('click', () => mudarMes(1));
// Notificação tocada com o app já aberto: o sw.js manda o endereço por mensagem.
function abrirDestino(destino) {
  const alvo = String(destino || '').split('#')[1] || '';
  if (alvo === 'financas') { est.secao = 'financas'; est.mes = null; }
  else if (alvo === 'expirar') { est.secao = 'tarefas'; est.aba = 'expirar'; }
  else return;
  guardar('camarada-secao', est.secao);
  render();
  window.scrollTo({ top: 0 });
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    if (!e.data?.abrir) return;
    abrirDestino(e.data.abrir);
    sincronizar(); // traz o gasto que acabou de chegar do Apple Pay
  });
}
window.addEventListener('hashchange', () => {
  abrirDestino(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
});
$('btn-ajustes').addEventListener('click', abrirAjustes);
$('fechar-dica').addEventListener('click', () => { $('dica-instalar').hidden = true; guardar('camarada-dica-fechada', true); });

// Volta da internet, app reaberto ou virada do dia: atualiza.
let diaMostrado = hoje();
window.addEventListener('online', () => sincronizar());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !token) return;
  diaMostrado = hoje();
  render();
  sincronizar();
});
setInterval(() => {
  if (!token) return;
  if (hoje() !== diaMostrado) { diaMostrado = hoje(); render(); }
  if (pendentesDeEnvio()) sincronizar();
}, 60e3);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* sem modo offline */ });

if (token) mostrarApp();
else mostrarEntrada();
