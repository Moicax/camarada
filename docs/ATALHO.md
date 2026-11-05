# Atalho "Camarada – Registrar compra"

O iPhone não deixa nenhum app ler as compras do Apple Pay diretamente. O caminho é o app
**Atalhos**: ele tem uma automação chamada **Transação** que roda a cada pagamento com Apple Pay
e entrega o valor, o estabelecimento e o cartão.

Este atalho é criado **uma vez só**, por quem cuida do Camarada. Depois, o link do iCloud vai
para `web/config.js` (`atalhoUrl`) e cada pessoa só toca em *Instalar atalho* dentro do app e cola
o próprio código.

> Os nomes abaixo são os do iOS 18 em português. Se algum estiver um pouco diferente no seu
> iPhone, procure pelo equivalente.

## Criar o atalho

1. Abra **Atalhos** → **+** (novo atalho). Dê o nome **Camarada – Registrar compra**.
2. Adicione a ação **Texto** e escreva `COLE_SEU_CODIGO` dentro dela.
3. Adicione a ação **Obter Conteúdo do URL**:
   - URL: `https://<project-ref>.supabase.co/functions/v1/registrar-compra`
   - Toque em **Mostrar Mais**:
     - **Método**: `POST`
     - **Corpo da Solicitação**: `JSON`
     - Adicione 4 campos, todos do tipo **Texto**:

| Chave | Valor |
|---|---|
| `token` | variável **Texto** (da ação do passo 2) |
| `valor` | **Entrada do Atalho** → toque nela e escolha **Valor** |
| `estabelecimento` | **Entrada do Atalho** → **Comerciante** |
| `cartao` | **Entrada do Atalho** → **Cartão ou Passe** |

4. Toque no **ⓘ** (detalhes do atalho) → **Configurar Importação** (ou *Perguntas de Importação*) →
   **Adicionar Pergunta** → escolha o texto `COLE_SEU_CODIGO`. Pergunta:
   `Cole o seu código do Camarada (Finanças → Compras automáticas → Copiar código)`.
5. Toque em **Compartilhar** → **Copiar Link do iCloud**. Esse é o `atalhoUrl`.

## O que cada pessoa faz (já explicado dentro do app)

1. No Camarada: **Finanças → Compras automáticas → Copiar código**.
2. **Instalar atalho** → *Adicionar Atalho* → cola o código.
3. Atalhos → **Automação** → **+** → **Transação** → marca os cartões → **Executar Imediatamente** →
   **Seguinte** → escolhe *Camarada – Registrar compra*.

A Apple não permite instalar uma automação por link, por isso o passo 3 sempre é manual.

## Testar sem comprar nada

No computador, com o código de uma conta:

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/registrar-compra \
  -H 'content-type: application/json' \
  -d '{"token":"<codigo>","valor":"R$ 1,00","estabelecimento":"Teste","cartao":"Nubank"}'
```

Resposta esperada: `{"ok":true,"mensagem":"R$ 1,00 · Teste — Nubank · ..."}`. A compra aparece em
Finanças e chega uma notificação (se estiverem ativadas). Depois é só apagar o gasto de teste no app.

## Se não funcionar

| Sintoma | Causa provável |
|---|---|
| Nada acontece ao pagar | A automação usa o gatilho **NFC** em vez de **Transação**, ou não está em *Executar Imediatamente* |
| Aparece "Código do Camarada inválido" | Código colado errado ou gerado de novo no app. Copie de novo e reinstale o atalho |
| Aparece "Valor inválido" | O campo `valor` não está ligado a **Entrada do Atalho → Valor** |
| Compra aparece, mas sem notificação | Notificações não ativadas em **Ajustes** do Camarada, ou o app não foi adicionado à Tela de Início |
