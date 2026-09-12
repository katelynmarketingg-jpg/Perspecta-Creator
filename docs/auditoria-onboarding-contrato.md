# Auditoria — Onboarding, Contrato, Assinatura e Aprovação

> Prompt para rodar a auditoria completa do caminho que vai do convite ao
> conteúdo aprovado. Use como está: cole numa sessão nova, com o repositório
> aberto. Ele foi escrito para ser **re-executável** — a cada rodada, o mesmo
> roteiro, para dar para comparar.

---

## Quem você é nesta tarefa

Você faz **três passagens** pelo mesmo caminho, e são três cabeças diferentes.
Não misture: cada uma enxerga o que as outras não veem.

**1. O programador.** Lê o código, não a tela. Procura o erro que ainda não
aconteceu: a conta que arredonda errado, o campo que aceita nulo onde não
deveria, a rota pública sem trava, o `COALESCE` que deixa um dado velho vencer
um novo, o índice que falta, a transação que pode ficar pela metade. Não
confia em nenhuma camada: se o servidor valida, a tela também tem que validar,
e vice-versa.

**2. O cliente.** Nunca viu o sistema. Recebeu um link no WhatsApp. Está no
celular, numa internet ruim, com pressa, e vai assinar um contrato que o
obriga a pagar todo mês. Ele erra: digita o CNPJ com pontos, cola um texto
gigante, fecha a aba no meio, volta dois dias depois, aperta o botão duas
vezes, recusa a permissão da câmera. **Tudo que ele não entender de primeira é
um defeito**, mesmo que o código esteja certo.

**3. A Perspectiva.** É a agência que vive disso. Ela precisa que o contrato
esteja **juridicamente correto e preenchido**, que a cobrança nasça na data
certa, que o que o cliente respondeu chegue inteiro, e que nada apareça para
o cliente antes da hora. Um contrato com `{{marcador}}` sobrando, um valor sem
separador de milhar, uma data por extenso errada — isso vai para um advogado
ler. É vergonha e é risco.

---

## Regras da auditoria

1. **Reproduza antes de afirmar.** Nenhum achado entra no relatório sem que
   você tenha rodado. Servidor de verdade (`node server/src/index.js` com um
   banco temporário) e navegador de verdade (Chromium via Playwright, em
   `/opt/pw-browsers/`). Teste no tamanho de celular (390px) **e** no
   computador (1280px).
2. **Cole a evidência.** Cada achado leva o comando, o trecho da resposta, a
   medida ou o erro do console. "Parece que" não é achado.
3. **Diga o que NÃO conseguiu verificar.** Se algo depende do ambiente dela
   (R2, domínio, chave da OpenAI), diga isso em vez de supor.
4. **Corrija na causa, não no sintoma.** E escreva um teste que falhe sem a
   correção — rode com e sem, e mostre os dois resultados.
5. **Português em tudo**: comentários, mensagens de erro, textos de tela.
6. **Não invente escopo.** Achado fora do caminho auditado vira uma linha na
   lista "fora do escopo", não uma reforma.

---

## O caminho a percorrer, na ordem

### Etapa 1 — A agência abre o onboarding
- [ ] Os termos que só ela sabe (serviço, quantidades, valor, vigência, data do
      contrato) são obrigatórios? O que acontece se ela pular?
- [ ] Escolher o serviço traz nome, valor e entregas? E se o serviço não tiver
      contrato escrito?
- [ ] A vigência calculada bate com o que um contrato diz? (de setembro a
      fevereiro são **6** meses, contando os dois extremos)
- [ ] Data invertida (fim antes do início), valor com vírgula, quantidade
      negativa, quantidade com casa decimal — o que entra no banco?
- [ ] Gerar o link duas vezes para o mesmo cliente cria dois links?
- [ ] O link tem domínio de verdade? (o erro clássico: `PUBLIC_URL` com só o
      nome do serviço, sem domínio, que dá DNS_PROBE_FINISHED_NXDOMAIN)

### Etapa 2 — O cliente responde
- [ ] O link abre sem login, no celular, e a marca da agência aparece?
- [ ] Fechar a aba no meio e voltar depois preserva as respostas?
- [ ] Pergunta obrigatória em branco: o sistema diz **quais** faltam, ou só
      "faltam perguntas"?
- [ ] Resposta gigante (colar 50 mil caracteres): corta? trava? derruba?
- [ ] CNPJ com pontuação, sem pontuação, inválido, de 13 dígitos — o que vai
      para o contrato?
- [ ] Dia de pagamento fora da faixa configurada. E o dia 31 em fevereiro?
- [ ] Envio de arquivos: `.HEIC` de iPhone aparece? Vídeo grande? Arquivo que
      não é foto nem vídeo? Dez de uma vez?
- [ ] Senha respondida no briefing fica em texto puro em algum lugar?
- [ ] Enviar duas vezes (clique duplo, ou voltar e reenviar) duplica alguma
      coisa — contrato, cobrança, aviso?

### Etapa 3 — O contrato nasce
> **A agência disse que esta parte está errada. Comece por aqui.**
- [ ] Gere o contrato e leia o texto **inteiro**, do começo ao fim, como um
      advogado leria. Sobrou algum `{{marcador}}`?
- [ ] Confira **um por um**: razão social, CNPJ formatado, endereço, quem
      assina e com que documento (CPF? OAB? o padrão não pode vencer a
      resposta), valor em número e por extenso, dia do pagamento, vigência em
      meses por extenso, data de início, data de fim, cidade, foro.
- [ ] Os números batem com o que a agência preencheu? Quantidade de posts, de
      vídeos, de captações?
- [ ] `R$ 1.500,00` e não `R$ 1500,00`. `12 (doze)` e não `12 ()`.
- [ ] Datas por extenso corretas, inclusive em mês com acento (março).
- [ ] Cliente sem CNPJ (pessoa física): o contrato ainda faz sentido?
- [ ] Valor zero, vigência de um mês, quantidade zero — o texto fica coerente?
- [ ] O contrato aparece para o cliente antes de a agência conferir? Deveria?

### Etapa 4 — O cliente assina
- [ ] O link de assinatura abre sem login? Expira? Pode ser reutilizado?
- [ ] Assinar duas vezes cria duas assinaturas?
- [ ] O que fica guardado como prova: nome, documento, data, IP, hash do
      texto? O hash muda se o texto do contrato mudar depois?
- [ ] Dá para alterar o contrato **depois** de assinado? Se sim, a assinatura
      continua valendo? (isso é um problema jurídico, não técnico)
- [ ] A agência é avisada na hora?
- [ ] Assinatura no celular: o campo de desenho funciona com o dedo?

### Etapa 5 — O acesso do cliente
- [ ] Ele cria o próprio usuário e senha. Nome já em uso? Senha curta?
      Caracteres estranhos? Acento?
- [ ] Um link antigo consegue trocar a senha de alguém?
- [ ] O nome de acesso chega no cadastro e a agência é avisada?
- [ ] Entrar com a senha errada várias vezes: existe alguma trava?

### Etapa 6 — Aprovação de conteúdo
- [ ] O cliente vê **apenas** o que foi enviado para ele? (tente pegar o
      conteúdo de outro cliente trocando o id na URL — isso tem que falhar)
- [ ] Aprovar, pedir ajuste, aprovar de novo — os estados batem dos dois lados?
- [ ] Peça enviada para aprovação continua visível para a agência?
- [ ] Formatos: post, carrossel e vídeo aparecem no mesmo tamanho, vertical
      (1080x1440), sem tarja preta?
- [ ] Carrossel: a capa é a **primeira** parte? Dá para deslizar?
- [ ] Vídeo: mostra o primeiro quadro rápido ou baixa o arquivo inteiro?
      (confira se a resposta é **206**, e não 200 com o arquivo todo)
- [ ] `.mov` de iPhone toca? (o Chrome recusa `video/quicktime`)
- [ ] Qualidade: a arte na grade é a original ou uma miniatura embolada?

### Etapa 7 — Dinheiro
- [ ] A cobrança nasce na data escolhida no briefing?
- [ ] Marcar como paga tira o aviso de "em aberto" da área do cliente?
- [ ] Pagamento parcial conta como pago?
- [ ] O recibo sai com os dados certos?

### Etapa 8 — Segurança do caminho todo
- [ ] Liste **todas** as rotas que respondem sem login (`/api/briefing`,
      `/api/sign`, `/api/files/shared`, portal). Para cada uma: o que ela
      deixa fazer se alguém adivinhar ou roubar o link?
- [ ] Token de um cliente acessa dado de outro? De outro escritório?
- [ ] Upload público: tipo, tamanho e quantidade têm teto?
- [ ] Algum dado sensível (senha, chave de API, token) aparece em log, em
      resposta de API ou na tela?

---

## O que entregar

Um relatório com os achados **ordenados por gravidade**, e cada um assim:

```
[GRAVE | MÉDIO | LEVE | POLIMENTO]  Título curto do problema
Onde:        arquivo:linha (e a tela, se tiver)
Como vi:     o comando/clique e a evidência colada
O que quebra: o que acontece de errado para a agência ou para o cliente
Correção:    o que mudar, e por quê essa e não outra
Teste:       o teste que falha sem a correção
```

E, no fim:
- **O que eu não consegui verificar**, e por quê.
- **Fora do escopo**: o que apareceu no caminho e não pertence a esta auditoria.

## Gravidade — o critério

- **GRAVE** — dado de um cliente vaza para outro; contrato sai com informação
  errada ou faltando; alguém perde trabalho já feito; cobrança na data errada;
  o cliente não consegue concluir.
- **MÉDIO** — funciona, mas a pessoa se perde, refaz trabalho, ou o resultado
  fica feio o bastante para a agência não querer mostrar.
- **LEVE** — incomoda, tem contorno óbvio.
- **POLIMENTO** — texto, espaçamento, palavra fora do tom.

## Ao corrigir

Um assunto por commit e por PR. Mensagem em português dizendo **o que quebrava
antes** — não só o que mudou. Teste junto, rodado com e sem a correção. E se
você mudar de ideia no meio (a medição contradisse o palpite), **diga isso no
PR**: vale mais do que parecer que acertou de primeira.
