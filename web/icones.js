// Ícones em linha, no estilo dos símbolos do iOS.
const svg = (corpo, extra = '') =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${corpo}</svg>`;

export const ic = {
  calendario: svg('<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>'),
  relogio: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  checkCirculo: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>'),
  circulo: svg('<circle cx="12" cy="12" r="9"/>'),
  alerta: svg('<path d="M12 3.5L2.5 20h19L12 3.5z"/><path d="M12 10v4.5M12 17.5v.01"/>'),
  mais: svg('<path d="M12 5v14M5 12h14"/>'),
  lixeira: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  adiar: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 2.5h6"/>'),
  desfazer: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),
  tarefas: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>'),
  carteira: svg('<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/><path d="M6 6l9-3 1.5 3"/>'),
  ajustes: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  esquerda: svg('<path d="M15 5l-7 7 7 7"/>'),
  direita: svg('<path d="M9 5l7 7-7 7"/>'),
  raio: svg('<path d="M13 2.5L4.5 13.5H12l-1 8 8.5-11H12l1-8z"/>'),
  cartao: svg('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>'),
  sino: svg('<path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16z"/><path d="M10 20.5a2 2 0 004 0"/>'),
  copiar: svg('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8"/>'),
  compartilhar: svg('<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/>'),
  sair: svg('<path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 17l5-5-5-5M15 12H4"/>'),
  repetir: svg('<path d="M17 2.8l3.2 3.2L17 9.2"/><path d="M3.8 11V9.6A3.6 3.6 0 017.4 6h12.8"/><path d="M7 21.2L3.8 18 7 14.8"/><path d="M20.2 13v1.4a3.6 3.6 0 01-3.6 3.6H3.8"/>'),
  entrada: svg('<path d="M12 4v13M6.5 11.5L12 17l5.5-5.5"/><path d="M5 20h14"/>'),
  investir: svg('<path d="M3.5 17.5l6-6 4 4 7-7.5"/><path d="M15 8h5.5v5.5"/>'),
  fechar: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};
