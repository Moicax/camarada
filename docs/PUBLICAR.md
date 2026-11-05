# Como publicar o Camarada

A publicação é automática: o GitHub roda `scripts/publicar.mjs` a cada envio para `main`. Ele:

1. cria (ou reaproveita) o projeto **camarada-app** no Supabase, na região São Paulo;
2. monta o banco de dados e as regras de segurança;
3. configura o login (contas novas entram direto, sem confirmar e-mail);
4. gera as chaves de notificação e o segredo dos avisos (só na primeira vez);
5. publica as funções `registrar-compra` e `notificar`;
6. agenda os avisos de tarefas todo dia às 9h (Brasília), dentro do próprio banco;
7. preenche `web/config.js` e publica no **endereço de teste**: **teste--camarada-organizador.netlify.app**.

> O endereço principal (**camarada-organizador.netlify.app**) continua com a versão antiga do
> Camarada, que as pessoas usam. Esta publicação nunca o altera: ela só publica com o apelido
> `teste` e, no fim, confere que a versão do endereço principal continua a mesma.

## O que você faz (uma vez só)

O GitHub precisa de duas chaves de acesso: uma do Supabase e uma do Netlify.

### 1. Chave do Supabase

1. Entre em **supabase.com/dashboard/account/tokens** (com a sua conta do Supabase).
2. Toque em **Generate new token**, dê o nome `camarada` e confirme.
3. Copie a chave (começa com `sbp_`). Ela só aparece uma vez.

### 2. Colar no GitHub

1. Abra **github.com/Moicax/camarada/settings/secrets/actions/new**.
2. **Name**: `SUPABASE_ACCESS_TOKEN`
3. **Secret**: cole a chave → **Add secret**.

### 3. Chave do Netlify

1. Entre em **app.netlify.com/user/applications#personal-access-tokens** (com a conta onde está o site atual).
2. **New access token** → descrição `camarada` → validade **No expiration** → **Generate token**.
3. Copie a chave.

### 4. Colar no GitHub

1. De novo em **github.com/Moicax/camarada/settings/secrets/actions/new**.
2. **Name**: `NETLIFY_AUTH_TOKEN`
3. **Secret**: cole a chave → **Add secret**.

### 5. Publicar

Abra **github.com/Moicax/camarada/actions/workflows/publicar.yml** → **Run workflow** → **Run workflow**.
Leva de 3 a 6 minutos na primeira vez (o Supabase demora para criar o projeto).

As chaves ficam guardadas criptografadas no GitHub; ninguém consegue lê-las de volta, nem você.

## Se der erro

Abra a execução em **Actions → Publicar**: o resumo no fim mostra o motivo em português.

| Mensagem | O que fazer |
|---|---|
| `401` no Supabase ou no Netlify | Chave copiada errada ou expirada. Gere outra e substitua o segredo |
| `limit` / `maximum number of projects` | O plano grátis do Supabase permite 2 projetos ativos. Pause ou apague um projeto antigo |
| `O projeto ... está pausado` | O Supabase pausa projetos grátis sem uso por 7 dias. Abra o painel e clique em *Restore project* |
| O site criado tem outro endereço | O site atual está em outra conta do Netlify. Gere a chave nessa conta |

## Depois de publicado

- Abra o site no iPhone pelo Safari → Compartilhar → **Adicionar à Tela de Início**.
- Abra pelo ícone, crie sua conta e vá em **Ajustes → Ativar notificações**.
- Para as compras automáticas, crie o atalho uma vez seguindo [ATALHO.md](ATALHO.md) e coloque o link
  em `atalhoUrl` no `web/config.js`.
