# Publicar direto no Instagram

Como funciona hoje, o que já está pronto e o que falta ligar.

---

## O que já existe no sistema

Tudo o que acontece **depois** de a Meta liberar o acesso já está feito e
testado:

| O quê | Onde | Situação |
|---|---|---|
| Conectar o Instagram de cada cliente (login da Meta) | Integrações → Redes sociais | pronto |
| Escolher a Página certa quando a conta tem várias | Integrações | pronto |
| Botão **Publicar agora** numa peça | Distribuição | pronto |
| **Publicar sozinho** na hora marcada | interruptor por cliente, em Integrações | pronto |
| Foto, **Reels** e **carrossel** (2 a 10 lâminas, na ordem) | — | pronto |
| Fila do automático: o que vai sair e o que está travado, com o motivo | Integrações | pronto |
| Aviso quando a peça passa da hora e não sai | sininho | pronto |
| Erro da Meta traduzido para português, com o que fazer | sininho e na peça | pronto |

**O que o sistema não publica de propósito:** *reel marcado como reel*. A
publicação por API recomprime o vídeo e perde qualidade — reel sai pelo app,
na mão. (Vídeo dentro de post comum vai normalmente.)

## O que falta

Um app seu na Meta. A Meta não deixa um sistema publicar em nome de ninguém
sem isso — não é uma escolha nossa. São três chaves; enquanto elas estiverem
vazias, a tela de Integrações mostra o passo a passo e o resto do sistema
funciona igual.

### 1. Criar o app

Em [developers.facebook.com/apps](https://developers.facebook.com/apps) →
**Criar app** → tipo **Empresa**.

Adicione dois produtos:

- **Login do Facebook**
- **Instagram Graph API**

### 1b. Se o app é "Login do Facebook **para empresas**"

É o tipo que a Meta cria hoje. Nele as permissões **não** vão na chamada do
login: elas ficam numa **configuração** feita no painel, e o login é chamado
com o número dela.

No app: **Login do Facebook para empresas → Configurações → Criar
configuração**. Escolha:

- **Ativos**: Páginas do Facebook e contas do Instagram;
- **Permissões**: `pages_show_list`, `pages_manage_posts`,
  `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`,
  `business_management`.

Salve e copie o **ID da configuração** → vai na variável `META_CONFIG_ID` do
Render.

**Por que isso importa:** sem o `META_CONFIG_ID`, num app desse tipo, o login
até funciona — mas o acesso volta **sem permissão de publicar**, e o erro só
aparece lá na frente, na hora de postar, dizendo "o app não tem permissão".
Longe de onde o problema realmente está.

Se o seu app tem o **Login do Facebook clássico** (sem "para empresas"), deixe
`META_CONFIG_ID` vazio: as permissões vão na chamada, como sempre.

### 2. Cadastrar o endereço de retorno

Em *Login do Facebook → Configurações → URIs de redirecionamento do OAuth
válidos*, cole o endereço que aparece na tela de Integrações. Ele é o endereço
do sistema mais `/api/integrations/meta/callback`.

**Tem de ser igual, letra por letra.** Uma barra a mais e a Meta devolve "URL
bloqueada", sem dizer qual é a certa. A tela de Integrações mostra o endereço
exato e avisa quando os dois não batem.

### 3. Guardar as chaves no Render

No painel do Render, aba **Environment**:

| Variável | Onde achar |
|---|---|
| `META_APP_ID` | painel do app, em Configurações → Básico |
| `META_APP_SECRET` | mesma tela, botão "Mostrar" |
| `META_REDIRECT_URI` | o mesmo endereço do passo 2 |
| `META_CONFIG_ID` | só no app "para empresas": o ID da configuração do passo 1b |

Salvar reinicia o serviço sozinho. Depois disso, o botão de conectar o
Instagram aparece em cada cliente.

### 4. Conta profissional vinculada à Página

Do lado do **cliente**, a Meta exige:

- Instagram em **conta profissional** (Comercial ou Criador de conteúdo);
- vinculado a uma **Página do Facebook**;
- e você precisa ser **administradora** dessa Página.

Sem o vínculo, o login funciona mas a conexão fica "só Facebook" — e carrossel,
que só existe no Instagram, não sai.

### 5. Revisão da Meta (App Review)

Enquanto o app está em **desenvolvimento**, ele só publica nas contas das
pessoas que forem adicionadas como *administradora, desenvolvedora ou
testadora* no próprio app. Isso **já serve** para as contas da casa.

Para publicar na conta de um cliente qualquer, o app precisa sair para o modo
**Live** e pedir **Acesso avançado** a duas permissões:

- `instagram_content_publish`
- `pages_manage_posts`

A Meta pede um vídeo curto mostrando o fluxo e costuma levar alguns dias.

## Depois de tudo ligado

1. **Integrações → Redes sociais → Conectar** no cliente. Na tela de permissões
   da Meta, **marque a Página dele** (a Meta abre tudo desmarcado — é o erro
   mais comum).
2. Ligue **Publicar sozinho** nesse cliente.
3. Programe a peça com arte anexada e aprovada pelo cliente.

O robô roda **a cada 5 minutos** e publica o que está aprovado, com arte e na
hora marcada. Ele corre atrás do atraso por **48 horas** e só pega o que foi
programado **depois** de o interruptor ser ligado — para não despejar dois dias
de posts de uma vez.

A fila, em Integrações, mostra antes da hora o que vai sair e o que está
travado, com o motivo de cada um.

## Quando algo não sai

O motivo aparece grudado na peça e no sininho, em português. Os mais comuns:

| O que aparece | O que fazer |
|---|---|
| proporção recusada | 1080×1350 ou 1080×1080 passam sempre |
| formato recusado | exportar em **JPG** (PNG, HEIC e WEBP costumam ser recusados) |
| arte pesada demais | o teto é 8 MB por foto |
| app sem permissão | reconectar o cliente marcando a Página dele |
| limite de publicações | são 50 posts por conta a cada 24 horas |
| acesso venceu | reconectar em Integrações (o aviso aparece antes de vencer) |
