# Camarada: visão de produto, público e caminho

## Contexto
O Camarada nasceu para resolver o problema de 2 ou 3 pessoas. A ideia é que, no futuro, ele seja
um app que outras pessoas queiram baixar. Ele deve continuar focado em organização (financeira,
pessoal e, talvez, saúde), sem virar um app lotado de coisas, e trazer algo que os outros não têm.

**Decisões do dono:**
- primeira aposta: **Dinheiro com dono** (já está no endereço de teste);
- público inicial: **pessoas sozinhas**;
- loja de apps: **só quando houver demanda**.

Agora o dono pede para acrescentar **para que público o app entrega**, com uma estimativa.

## A visão: uma resposta por dia, não um painel
Os outros apps separam as áreas: finanças (Mobills, Organizze, o app do banco), tarefas (Todoist)
e saúde (app Saúde). O Camarada **liga as áreas** e responde todo dia: *o que eu faço hoje e
quanto posso gastar*.

**Promessa:** *"O Camarada te diz o que fazer hoje e quanto você pode gastar, e faz o resto sozinho."*

**Filtro contra o "app lotado":**
1. Só entra o que muda a tela Hoje.
2. Digitar o mínimo.
3. Um número por área.
4. O Camarada fala uma vez por dia.
5. Nunca pede senha de banco.
6. No máximo 4 abas.

## Para quem o Camarada entrega (estimativa)

### O problema é de muita gente
- **82% das famílias têm dívidas a vencer.** Esse é o recorde da pesquisa Peic/CNC, de julho de
  2026. Nas famílias com renda de até 3 salários mínimos, são 84,9%.
- **Cerca de 84 milhões de pessoas estão com contas atrasadas.** O dado é da Serasa, de setembro de
  2026, e equivale a quase metade dos adultos.
- O sentimento por trás disso é o mesmo: **"o salário acaba antes do mês"** e **"esqueci a conta"**.
  O Camarada ataca as duas coisas: o limite do dia, com as contas já separadas, e os avisos de prazo.

### Quem ele atende por inteiro hoje (o público principal)
> Hoje, sem as mudanças da seção "Ampliar para 15 a 40 anos":
> **Adulto de 20 a 40 anos, com renda mensal fixa (CLT, servidor, estagiário), que usa iPhone e paga
> por aproximação, e vive no limite do mês.**
> Exemplo: 27 anos, salário de R$ 3.500, Nubank no crédito, aluguel e conta de luz, e no dia 20 já
> não sabe quanto pode gastar.

- Só ele tem a experiência completa: compras do Apple Pay entrando sozinhas, número do dia, contas
  separadas, avisos e bom dia.
- **Ordem de grandeza (estimativa grosseira):** o iPhone é cerca de **1 em cada 5 celulares** em uso
  no Brasil (cerca de 21% do tráfego, StatCounter, junho de 2026). Cruzando com quem tem renda
  mensal fixa, o público que o app atende por inteiro fica na casa de **alguns milhões de pessoas**.
  O público que tem o problema são dezenas de milhões.
- **Para começar:** os primeiros 100 a 1.000 usuários vêm de amigos e conhecidos com esse perfil,
  pelo link de convite, que já existe.

### Quem ele atende pela metade hoje
| Público | O que já funciona | O que falta |
|---|---|---|
| **Quem usa Android** (cerca de 4 em cada 5 celulares) | Tudo, menos a compra automática | Compra automática: no Android não existe o app Atalhos |
| **Renda variável** (autônomo, freelancer, comissionado) | Entradas, contas, tarefas | Limite do dia baseado no que **já entrou**, não num salário fixo |
| **Quem tem muitos compromissos e remédios** (35+, cuidadores) | Prazos, horários, avisos | Etapa de Saúde: remédio todo dia, consultas |
| **Casais e repúblicas** | Cada um com a sua conta | Dividir contas (etapa "em dupla") |

### Quem não é o público (de propósito)
- **Quem quer investir a fundo:** carteira, cotações, imposto. Já existem bons apps para isso.
- **Empresas e MEI:** fluxo de caixa de negócio é outro produto.
- **Quem quer só um app de tarefas genérico:** o Camarada é sobre o dia a dia com dinheiro.

## Ampliar para 15 a 40 anos
O dono quer alcançar também quem tem **15 a 19 anos**. Esse público muda três coisas:
1. **Quase ninguém tem salário.** A renda vem de mesada, estágio, Jovem Aprendiz, bicos ou Pix da família.
2. **A maioria usa Android, e o Pix pesa mais que o Apple Pay.**
3. **Responde a metas, sequência de dias e compartilhar.**

O que fazer, sem fugir do foco e sem lotar o app:

| # | Ideia | Por que atrai 15–25 | Como cabe no que já existe |
|---|---|---|---|
| 1 | **Dinheiro sem salário:** mesada semanal, estágio, bicos. O limite do dia sai do que **já entrou**, por semana ou por mês | É o dinheiro real dessa idade | Junto com a etapa "renda variável": muda só a base do cálculo em `web/lib/finance.js` (`resumoMes`) |
| 2 | **Objetivos ("Juntar para…")**: "R$ 600 para o show até março". O Camarada separa um pouco por dia | É o maior motivador de quem é jovem: comprar algo que quer | Usa o mesmo motor do **Dinheiro com dono**: o objetivo é dinheiro que já tem dono (o você do futuro). Mesma tela, mesmo filtro |
| 3 | **Lançar em 2 segundos:** por voz no iPhone ("E aí Siri, gastei 20 no lanche"), por um atalho que chama o mesmo `registrar-compra`. No Android, o app gratuito **MacroDroid** lê a notificação do banco ou do Pix e manda para o Camarada | Pix e Android são o dia a dia dessa idade; ninguém lança gasto à mão | Reaproveita `supabase/functions/registrar-compra/index.ts`, que já aceita qualquer formato de campo, e a tela de Compras automáticas, que ganha a aba "Android" |
| 4 | **Escola e faculdade:** provas, trabalhos, matrícula, ENEM | Prazos são a vida do estudante | Já funciona: é só a categoria padrão **Estudos** na conta nova (`nova_conta`, no banco) |
| 5 | **Cartão da semana para os stories:** pontos, sequência, "6 de 7 dias no limite" | Compartilhar é como essa idade descobre apps | Etapa "Desejo": uma imagem gerada da tela Hoje, sem rede social dentro do app |
| 6 | **Cor do app e modo escuro** | Personalizar dá sensação de "meu app" | O app antigo já tinha cor e tema; volta só como opção em Ajustes |

**Cuidados com quem tem menos de 18 anos:**
- **Dados mínimos:** só nome, sem e-mail nem CPF, como já é hoje.
- **Nada de anúncio, crédito ou empréstimo.**
- **Nunca pede senha de banco**, como já é hoje.
- **Termos de uso simples**, dizendo que menores usam com o conhecimento dos responsáveis.
- Antes de divulgar para menores, vale uma conferência rápida com alguém de direito sobre a LGPD.

**Divulgação para essa idade:**
- vídeos curtos mostrando "quanto eu posso gastar hoje" em 10 segundos;
- convite entre amigos, que já existe;
- desafio da sequência de dias.

## Caminho (atualizado pelo público)
1. ✅ **Dinheiro com dono**: contas com valor separadas do limite, "Paguei" e bom dia. Está no
   teste, esperando o "pode publicar".
2. ✅ **Dinheiro sem salário** (renda variável, mesada semanal e estágio) **e Objetivos ("Juntar
   para…")**. Está no teste. As duas usam o motor do Dinheiro com dono e abrem os públicos de 15 a 25 anos e de
   autônomos.
3. **Lançar em 2 segundos:** voz no iPhone e notificação do banco ou do Pix no Android, pelo
   MacroDroid, sem precisar de app de loja.
4. **Desejo e crescimento:** começar em 60 segundos, cartão da semana para os stories, categoria
   Estudos, cor e modo escuro.
5. **Saúde sem inchaço:** remédio todo dia com horário, consultas e exames, passos e sono.
6. **Loja de apps:** só com demanda, para o widget "Hoje: R$ 87" na tela bloqueada.

## Verificação
Este acréscimo é análise de público e ordem do caminho: não muda código. Quando cada etapa nova for
feita, segue o mesmo processo de sempre:
1. `npm test`;
2. `scripts/verificar.mjs` no endereço de teste;
3. publicar no endereço principal só com o "pode publicar".

**Fontes das estimativas:** Peic/CNC (endividamento, julho de 2026), Serasa (inadimplência,
setembro de 2026) e StatCounter (iOS no Brasil, junho de 2026). São ordens de grandeza para
decidir prioridades, não pesquisa de mercado.
