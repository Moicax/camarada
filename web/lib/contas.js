// Contas: entrar com o nome, como no app antigo. Por dentro, cada nome vira um e-mail que
// ninguém recebe (o login do Supabase precisa de um), sempre no mesmo domínio do site.

export const DOMINIO_CONTAS = 'contas.camarada-organizador.netlify.app';

/** "Moisés", "moises" e " MOISÉS " entram na mesma conta. Espaços viram hífen: "João Silva" → joao-silva. */
export function nomeDeEntrada(nome) {
  return String(nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 30).replace(/-+$/, '');
}

/** O que a pessoa digitou no campo de entrada vira o e-mail do login (quem tem e-mail de verdade usa o e-mail). */
export function emailDeEntrada(nomeOuEmail) {
  const s = String(nomeOuEmail ?? '').trim();
  if (s.includes('@')) return s.toLowerCase();
  const login = nomeDeEntrada(s);
  return login ? `${login}@${DOMINIO_CONTAS}` : '';
}

/** Senha provisória fácil de ditar: 8 letras e números sem os que confundem (0/O, 1/l), ex.: "k7mq-4hxa". */
export function senhaProvisoria(aleatorio = (n) => Math.floor(Math.random() * n)) {
  const LETRAS = 'abcdefghjkmnpqrstuvwxyz23456789';
  const s = Array.from({ length: 8 }, () => LETRAS[aleatorio(LETRAS.length)]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
