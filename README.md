# Camarada

> **Versão de teste.** Publicada em https://teste--camarada-organizador.netlify.app.
> O endereço principal continua com a versão antiga, que as pessoas usam; as duas serão unificadas depois.

Organizador pessoal para iPhone: **tarefas com prazo** e **controle de gastos do mês**.
Cada pessoa cria a própria conta e só enxerga os próprios dados.

## O que faz

**Tarefas**
- Três abas: *Pendentes*, *Vencendo* e *Feitas*, organizadas sozinhas pela data.
- Cada categoria define com quantos dias de antecedência a tarefa passa para *Vencendo* (ex.: Contas 5 dias, Documentos 15 dias).
- Horário opcional, com lembretes **3 horas, 1 hora e 10 minutos antes**.
- Tarefas que **repetem** (toda semana, todo mês, todo ano): ao concluir, a próxima já aparece.
- Tarefa **sem data** fica em *Pendentes*.
- Arrastar para a direita conclui (com confirmação); arrastar para a esquerda mostra *Adiar* e *Apagar*.
- *Adiar* com um toque: 1 dia, 3 dias, 1 semana, 1 mês ou outra data.
- Número no ícone do app com as tarefas em *Vencendo*.
- Avisos do dia no horário escolhido: quando a tarefa entra em *Vencendo*, na véspera, no dia e no dia seguinte. Botão para testar a notificação.

**Finanças**
- Renda do mês → quanto já gastou → quanto resta → **quanto dá para gastar hoje**.
- **Crédito × à vista**: crédito vai para a fatura do cartão; à vista (débito, Pix, dinheiro) sai do salário na hora. Cartões de débito são marcados em Ajustes.
- Faturas do mês por cartão e gastos por dia.
- **Investimentos**: meta de quanto investir por mês; cada investimento sai do que dá para gastar, mas não conta como gasto.
- **Meta de gastos**: máximo para gastar no mês, com alerta (e notificação) aos 80% e aos 100%, uma vez por mês cada.
- **Compras automáticas**: cada compra com Apple Pay entra sozinha, com uma notificação ("R$ 23,90 · Padaria — hoje ainda dá para gastar R$ 79,61"). Funciona com um atalho do iPhone configurado uma vez ([docs/ATALHO.md](docs/ATALHO.md)).
- Lançamento manual para compras sem Apple Pay.

## Como é feito

| Parte | Onde roda | Custo |
|---|---|---|
| App (pasta `web/`) | Netlify ou Cloudflare Pages | grátis |
| Contas e banco de dados | Supabase | grátis (até 50 mil usuários) |
| Receber compras e enviar avisos (`supabase/functions/`) | Supabase Edge Functions | grátis |
| Avisos diários às 9h | Supabase (agendamento no banco) | grátis |
| Publicação automática | GitHub Actions | grátis |

O app é uma página web instalável (Safari → Compartilhar → *Adicionar à Tela de Início*), sem App Store.

## Testar no computador

```bash
npm test      # testes da lógica de tarefas e finanças
npm run dev   # abre em http://localhost:5173
```

Sem configurar o Supabase, o app abre em **modo demonstração**, com dados de exemplo guardados só no navegador.

## Publicar

Veja [docs/PUBLICAR.md](docs/PUBLICAR.md).

## Estrutura

```
web/                     app (HTML, CSS e JavaScript, sem build)
  lib/                   lógica pura: datas, tarefas, finanças (testada)
  api.js                 acesso ao Supabase ou ao modo demonstração
  config.js              endereço do Supabase e link do atalho
supabase/
  migrations/            tabelas, segurança por usuário (RLS)
  functions/registrar-compra   recebe a compra do Atalho do iPhone
  functions/notificar          avisos diários de tarefas
  functions/_shared/     cópia da lógica de web/lib (npm run sync)
tests/                   testes (node --test)
.github/workflows/       testes e publicação automática
scripts/publicar.mjs     cria/atualiza Supabase e Netlify (roda no GitHub)
```

Ao mudar algo em `web/lib/`, rode `npm run sync` para copiar para o servidor (um teste confere isso).

## Próximos passos possíveis

- **Conectar banco (Open Finance)**: puxar todas as compras do cartão sem atalho. O banco de dados já aceita `origem = 'openfinance'`; falta contratar um agregador (ex.: Pluggy) quando houver usuários pagantes.
- Importar fatura do cartão (CSV/OFX).
- Busca e marcação de tarefas importantes.
