# Compras automáticas do Apple Pay

O iPhone não deixa nenhum app ler as compras do Apple Pay diretamente. O caminho é o app
**Atalhos**: a automação **Carteira** ("Quando Qualquer Cartão for aproximado") roda a cada
pagamento com o iPhone e entrega o valor, o comerciante e o cartão.

A Apple exige que cada pessoa crie a própria automação (não dá para compartilhar uma automação
por link). Por isso o app faz o resto ficar fácil:

## O que cada pessoa faz (explicado no app, em Ajustes → Compras automáticas)

1. **Copiar texto**: o app copia um texto pronto, já com o código pessoal dela.
2. No app **Atalhos** → **Automação** → **+** → **Carteira** → *Qualquer Cartão* →
   **Executar Imediatamente** → **Seguinte** → **Nova Automação em Branco**.
3. Na caixa **"Descreva…"**, cola o texto: o próprio Atalhos monta a automação.
4. Paga algo com o iPhone. A compra aparece em Finanças e o status fica verde.

O texto está em `web/lib/atalho.js` (`textoDaAutomacao`). É o texto que funcionou num iPhone
real (iOS em português): mudar as palavras pode mudar o que o Atalhos monta.

Sem a caixa "Descreva…" (iPhones sem Apple Intelligence), o app mostra o passo a passo à mão,
com botões para copiar o endereço e o código.

## O que a automação manda

`POST https://<projeto>.supabase.co/functions/v1/registrar-compra`, corpo JSON:

| Campo | Variável no iPhone |
|---|---|
| `valor` | Valor |
| `comerciante` | Comerciante |
| `cartao` | Cartão ou Tíquete |
| `token` | o código da pessoa (Ajustes → Compras automáticas) |

O servidor também entende `estabelecimento`/`local` no lugar de `comerciante`, e não liga para
maiúsculas, acentos ou espaços sobrando nos nomes dos campos.

## Status da conexão

Cada chamada do Atalho fica anotada em `tentativas_atalho` (14 dias). O app mostra a última:
⏳ aguardando a primeira compra, ✅ conectado (última compra recebida…), ⚠️ o que corrigir
(ex.: "a compra chegou sem o valor").

## Atalho do app antigo

Quem já tinha o Atalho do app antigo (endereço `https://camarada-organizador.netlify.app/api/gasto/<segredo>`)
não precisa mudar nada: o site repassa esse endereço para `registrar-compra/legado/<segredo>`.
