# Como publicar o Camarada

Faça isto uma vez. Depois, toda mudança enviada ao GitHub se publica sozinha.

## 1. Supabase (contas e banco de dados)

1. Entre em [supabase.com](https://supabase.com) e crie um projeto (plano Free, região *South America (São Paulo)*). Anote a **senha do banco** que você escolher.
2. Em **Project Settings → API**, anote:
   - **Project URL** (ex.: `https://abcdxyz.supabase.co`). O trecho `abcdxyz` é o **Project ref**.
   - **anon public key**.
3. Em **Authentication → URL Configuration**, coloque o endereço do site em **Site URL** (ex.: `https://camarada-organizador.netlify.app`).
4. Crie um token pessoal em [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).

## 2. Segredos no GitHub

No repositório: **Settings → Secrets and variables → Actions → New repository secret**. Crie:

| Nome | Valor |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | token do passo 1.4 |
| `SUPABASE_PROJECT_REF` | o *Project ref* (ex.: `abcdxyz`) |
| `SUPABASE_DB_PASSWORD` | senha do banco do passo 1.1 |
| `VAPID_PUBLIC_KEY` | chave pública de notificações (veja abaixo) |
| `VAPID_PRIVATE_KEY` | chave privada de notificações |
| `VAPID_SUBJECT` | `mailto:` + seu e-mail (ex.: `mailto:voce@gmail.com`) |
| `CRON_SECRET` | uma senha longa qualquer (protege os avisos diários) |

Para gerar as chaves de notificação: `npx web-push generate-vapid-keys`.

Depois, em **Actions → Publicar servidor → Run workflow**. Isso cria as tabelas e publica as funções.

## 3. Configurar o app

Edite `web/config.js`:

```js
export const CONFIG = {
  supabaseUrl: 'https://abcdxyz.supabase.co',
  supabaseAnonKey: '<anon public key>',
  vapidPublicKey: '<a mesma VAPID_PUBLIC_KEY>',
  atalhoUrl: '', // preenchido no passo 5
};
```

A *anon key* e a chave pública podem ficar no código: elas são públicas por natureza. A segurança vem das regras do banco (cada pessoa só acessa os próprios dados).

## 4. Site (Netlify)

Para manter o endereço atual (`camarada-organizador.netlify.app`):

1. No Netlify, abra o site → **Site configuration → Build & deploy → Link repository**.
2. Escolha GitHub → `camarada`. Deixe *Build command* vazio e *Publish directory* = `web` (o arquivo `netlify.toml` já diz isso).

A partir daí, cada envio ao GitHub atualiza o site.

## 5. Atalho do iPhone

Siga [ATALHO.md](ATALHO.md) para criar o atalho uma vez e copiar o link do iCloud para `atalhoUrl` em `web/config.js`.

## Conferir

- Abra o site no iPhone pelo Safari → Compartilhar → **Adicionar à Tela de Início**.
- Abra pelo ícone, crie sua conta, vá em **Ajustes → Ativar notificações**.
- Em **Finanças → Compras automáticas**, siga os 4 passos e faça uma compra com Apple Pay.
- Para testar os avisos de tarefas sem esperar as 9h: **Actions → Avisos diários → Run workflow**.
