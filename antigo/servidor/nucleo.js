// Núcleo do servidor: dados iniciais, mescla da sincronização e senha.
// Não sabe onde os dados ficam guardados, para poder ir para a nuvem sem reescrever.
import crypto from 'node:crypto';
import { HORA } from '../app/regras.js';

const ISO_DIA = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[\w-]{8,64}$/;
const COR = /^#[0-9a-fA-F]{6}$/;
const CORES_APP = ['azul', 'verde', 'vinho', 'laranja', 'grafite'];
const REPETE = ['semanal', 'mensal', 'anual'];
const TEMAS = ['claro', 'escuro', 'auto'];
const GUARDAR_APAGADOS_DIAS = 90;

const texto = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const inteiro = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);
const idOuNulo = v => (typeof v === 'string' && ID.test(v) ? v : null);
const dia = v => (typeof v === 'string' && ISO_DIA.test(v) ? v : null);

export function dadosIniciais(agora = new Date()) {
  const t = agora.toISOString();
  const sugestoes = [['Contas', '#007AFF', 5], ['Documentos', '#AF52DE', 45], ['Saúde', '#34C759', 7], ['Casa', '#FF9500', 3], ['Trabalho', '#FF3B30', 2]];
  return {
    versao: 1,
    categorias: sugestoes.map(([nome, cor, aviso_dias], ordem) => ({ id: crypto.randomUUID(), nome, cor, aviso_dias, ordem, apagado: false, atualizado_em: t })),
    itens: [],
    gastos: [],
    preferencias: { apelido: 'Camarada', cor: 'azul', aviso_padrao: 7, tema: 'claro', horario: 7, renda: 0, aviso_gasto: true, debito: [], atualizado_em: t }
  };
}

const ORIGENS = ['applepay', 'manual', 'importado'];
export function limparGasto(r) {
  if (!r || !idOuNulo(r.id) || typeof r.atualizado_em !== 'string') return null;
  const valor = inteiro(r.valor, 1, 1e10);
  if (valor === null) return null;
  return {
    id: r.id,
    valor,
    descricao: texto(r.descricao, 120).trim() || 'Gasto',
    cartao: texto(r.cartao, 40).trim(),
    data: dia(r.data) || new Date().toISOString().slice(0, 10),
    origem: ORIGENS.includes(r.origem) ? r.origem : 'manual',
    forma: r.forma === 'avista' ? 'avista' : 'credito',
    apagado: r.apagado === true,
    criado_em: texto(r.criado_em, 40),
    atualizado_em: texto(r.atualizado_em, 40)
  };
}

export function limparItem(r) {
  if (!r || !idOuNulo(r.id) || typeof r.atualizado_em !== 'string') return null;
  return {
    id: r.id,
    titulo: texto(r.titulo, 200).trim() || 'Sem título',
    categoria_id: idOuNulo(r.categoria_id),
    data_limite: dia(r.data_limite),
    // hora só vale junto com a data
    hora: dia(r.data_limite) && typeof r.hora === 'string' && HORA.test(r.hora) ? r.hora : null,
    aviso_dias: inteiro(r.aviso_dias, 0, 365),
    recorrencia: REPETE.includes(r.recorrencia) ? r.recorrencia : null,
    dia_original: inteiro(r.dia_original, 1, 31),
    concluido_em: dia(r.concluido_em),
    proximo_id: idOuNulo(r.proximo_id),
    gerado_de: idOuNulo(r.gerado_de),
    notas: texto(r.notas, 2000),
    apagado: r.apagado === true,
    criado_em: texto(r.criado_em, 40),
    atualizado_em: texto(r.atualizado_em, 40)
  };
}

export function limparCategoria(r) {
  if (!r || !idOuNulo(r.id) || typeof r.atualizado_em !== 'string') return null;
  return {
    id: r.id,
    nome: texto(r.nome, 40).trim() || 'Sem nome',
    cor: COR.test(r.cor) ? r.cor : '#6B7785',
    aviso_dias: inteiro(r.aviso_dias, 0, 365) ?? 7,
    ordem: inteiro(r.ordem, 0, 9999) ?? 0,
    apagado: r.apagado === true,
    atualizado_em: texto(r.atualizado_em, 40)
  };
}

export function limparPreferencias(r) {
  if (!r || typeof r.atualizado_em !== 'string') return null;
  return {
    apelido: texto(r.apelido, 30).trim(),
    cor: CORES_APP.includes(r.cor) ? r.cor : 'azul',
    aviso_padrao: inteiro(r.aviso_padrao, 0, 365) ?? 7,
    tema: TEMAS.includes(r.tema) ? r.tema : 'claro',
    horario: inteiro(r.horario, 5, 22) ?? 7,
    renda: inteiro(r.renda, 0, 1e10) ?? 0,
    aviso_gasto: r.aviso_gasto !== false,
    // nomes dos cartões de débito: compras do Apple Pay com eles entram como à vista
    debito: Array.isArray(r.debito) ? [...new Set(r.debito.map(c => texto(c, 40).trim()).filter(Boolean))].slice(0, 30) : [],
    atualizado_em: texto(r.atualizado_em, 40)
  };
}

// Junta o que o aparelho mandou com o que está guardado. Vale a versão editada por último.
export function mesclar(dados, recebido = {}, agora = Date.now()) {
  const tipos = [['itens', limparItem], ['categorias', limparCategoria], ['gastos', limparGasto]];
  for (const [tipo, limpar] of tipos) {
    if (!Array.isArray(dados[tipo])) dados[tipo] = [];
    const lista = Array.isArray(recebido[tipo]) ? recebido[tipo].slice(0, 5000) : [];
    for (const bruto of lista) {
      const r = limpar(bruto);
      if (!r) continue;
      const i = dados[tipo].findIndex(x => x.id === r.id);
      if (i < 0) dados[tipo].push(r);
      else if (r.atualizado_em > dados[tipo][i].atualizado_em) dados[tipo][i] = r;
    }
    const limite = new Date(agora - GUARDAR_APAGADOS_DIAS * 864e5).toISOString();
    dados[tipo] = dados[tipo].filter(x => !(x.apagado && x.atualizado_em < limite));
  }
  const p = limparPreferencias(recebido.preferencias);
  if (p && p.atualizado_em > dados.preferencias.atualizado_em) dados.preferencias = p;
  return dados;
}

export const paraEnvio = dados => ({ itens: dados.itens, categorias: dados.categorias, gastos: dados.gastos || [], preferencias: dados.preferencias });

const scrypt = (senha, sal) => new Promise((ok, erro) => crypto.scrypt(senha, sal, 32, (e, k) => (e ? erro(e) : ok(k))));

export async function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  return sal.toString('hex') + ':' + (await scrypt(senha, sal)).toString('hex');
}

export async function conferirSenha(senha, guardado) {
  const [sal, hash] = String(guardado).split(':');
  if (!sal || !hash) return false;
  const calculado = await scrypt(senha, Buffer.from(sal, 'hex'));
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === calculado.length && crypto.timingSafeEqual(calculado, esperado);
}

export const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
