// Datas no formato 'AAAA-MM-DD' (sem fuso), para evitar erros de horário de verão e fuso.

const pad = (n) => String(n).padStart(2, '0');

/** Dia (AAAA-MM-DD) de um instante, no fuso indicado (ou no fuso do aparelho). */
export function diaLocal(instante = new Date(), timeZone) {
  const d = instante instanceof Date ? instante : new Date(instante);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(d);
}

function partes(iso) {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { a, m, d };
}

function utc(iso) {
  const { a, m, d } = partes(iso);
  return Date.UTC(a, m - 1, d);
}

function deUtc(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Quantos dias de `de` até `ate` (positivo se `ate` é depois). */
export function diasEntre(de, ate) {
  return Math.round((utc(ate) - utc(de)) / 86400000);
}

export function somarDias(iso, n) {
  return deUtc(utc(iso) + n * 86400000);
}

/** Soma meses mantendo o dia; se o mês não tiver o dia, usa o último (31/01 + 1 mês = 28/02). */
export function somarMeses(iso, n) {
  const { a, m, d } = partes(iso);
  const total = a * 12 + (m - 1) + n;
  const na = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const ultimo = diasNoMes(`${na}-${pad(nm)}`);
  return `${na}-${pad(nm)}-${pad(Math.min(d, ultimo))}`;
}

/** 'AAAA-MM' de uma data 'AAAA-MM-DD'. */
export function chaveMes(iso) {
  return iso.slice(0, 7);
}

export function diasNoMes(chave) {
  const [a, m] = chave.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

export function mudarMes(chave, n) {
  return chaveMes(somarMeses(`${chave}-01`, n));
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export function nomeMes(chave) {
  const [a, m] = chave.split('-').map(Number);
  const nome = MESES[m - 1];
  return `${nome[0].toUpperCase()}${nome.slice(1)} de ${a}`;
}

/** '05/11' */
export function diaCurto(iso) {
  const { m, d } = partes(iso);
  return `${pad(d)}/${pad(m)}`;
}

const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** 'Hoje', 'Ontem' ou 'quarta, 05/11' */
export function rotuloDia(iso, hoje) {
  const dif = diasEntre(iso, hoje);
  if (dif === 0) return 'Hoje';
  if (dif === 1) return 'Ontem';
  const dow = new Date(utc(iso)).getUTCDay();
  const nome = SEMANA[dow];
  return `${nome[0].toUpperCase()}${nome.slice(1)}, ${diaCurto(iso)}`;
}
