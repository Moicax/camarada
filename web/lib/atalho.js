// Compras automáticas do Apple Pay: o texto pronto que monta a automação no app Atalhos e a
// situação da conexão (a partir da última vez que o Atalho chamou o servidor).

/**
 * Texto para colar na caixa "Descreva…" do app Atalhos, já com o código da pessoa.
 * É o mesmo texto que funcionou no iPhone (iOS em português, gatilho "Carteira"): o próprio
 * Atalhos monta a automação. Mudar as palavras aqui pode mudar o que ele monta.
 */
export function textoDaAutomacao(url, codigo) {
  return `Monte esta automação da Carteira exatamente assim, sem nenhuma ação extra:

1. Ação "Obter Conteúdo do URL":
- URL: ${url}
- Método: POST
- Pedir Corpo: JSON
- Exatamente 4 campos, todos do tipo Texto, com os nomes escritos exatamente assim, em minúsculas, sem acento e sem espaço:
  valor = a propriedade "Valor" da transação que disparou a automação
  comerciante = a propriedade "Comerciante" da transação
  cartao = a propriedade "Cartão ou Tíquete" da transação
  token = o texto fixo ${codigo}
- Em valor, comerciante e cartao use a propriedade da transação, nunca a transação inteira.

2. Ação "Mostrar Notificação" com título "Camarada" e corpo igual a "Conteúdos do URL".

Não peça confirmação, não peça nenhuma entrada e não adicione outras ações.`;
}

const pad = (n) => String(n).padStart(2, '0');

/** "hoje às 12:07", "ontem às 18:30" ou "05/11 às 09:15" (no fuso do aparelho). */
export function quandoFoi(instante, agora = new Date()) {
  const d = new Date(instante);
  const dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((dia(agora) - dia(d)) / 864e5);
  const hora = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (dias === 0) return `hoje às ${hora}`;
  if (dias === 1) return `ontem às ${hora}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${hora}`;
}

/**
 * Situação das compras automáticas, para mostrar no app.
 * `tentativa`: a última chamada do Atalho que o servidor ligou a esta conta ({ criado_em, status, motivo })
 * ou null; `temCompras`: se já existe alguma compra registrada pelo Atalho.
 * Devolve { tom: 'ok' | 'aviso' | 'espera', titulo, texto }.
 */
export function situacaoDoAtalho({ tentativa, temCompras }, agora = new Date()) {
  if (!tentativa) {
    return temCompras
      ? { tom: 'ok', titulo: 'Conectado', texto: 'As compras do Apple Pay estão chegando.' }
      : { tom: 'espera', titulo: 'Aguardando sua primeira compra', texto: 'Depois de criar a automação, pague algo com o iPhone. Em alguns segundos ela aparece em Finanças e aqui fica verde.' };
  }
  const quando = quandoFoi(tentativa.criado_em, agora);
  if (tentativa.status === 200) {
    return { tom: 'ok', titulo: 'Conectado', texto: `Última compra recebida ${quando}.` };
  }
  if (tentativa.status === 400) {
    return {
      tom: 'aviso',
      titulo: 'A última compra chegou sem o valor',
      texto: `Foi ${quando}. Na automação, o campo valor precisa usar a variável Valor da compra (não a compra inteira). Essa compra não entrou: lance à mão em Finanças.`,
    };
  }
  return {
    tom: 'aviso',
    titulo: 'A última compra não foi salva',
    texto: `Foi ${quando}, por um erro no servidor. Lance essa compra à mão em Finanças; as próximas devem entrar normalmente.`,
  };
}
