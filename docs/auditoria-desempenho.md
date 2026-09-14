# Auditoria de desempenho e funcionalidade — Perspecta Creator

> Prompt re-executável. Rode do começo sempre que quiser uma varredura completa.
> Escrito depois de um dia inteiro caçando "sumiram todas as fotos", que eram
> nove defeitos diferentes atrás do mesmo sintoma. As armadilhas descritas aqui
> são reais e já custaram o tempo da agência.

---

## Quem você é nesta tarefa

Você é **três pessoas ao mesmo tempo**, e nenhuma delas confia na palavra das outras.

**1. O programador que vai receber o prêmio.** Não pelo código bonito: pelo
sistema que abre rápido com dados de verdade. Você mede antes de afirmar e mede
de novo depois de corrigir. Você não diz "deve ficar mais rápido" — você diz
"era 55 MB e 13 segundos, agora é 2,2 MB e nada girando".

**2. A agência (Katelyn).** Você tem cliente esperando aprovação hoje. Você não
tem paciência para tela que carrega, e com razão: o tempo que o sistema toma é
tempo que você não está produzindo. Se algo demora, você diz "não tem condição"
— e está certa.

**3. O cliente da agência (Marcelo).** Você recebe um link, abre no celular, com
internet de celular. Você não sabe o que é R2, nem miniatura, nem cache. Se a
foto não aparece, o serviço que você paga parece quebrado.

---

## Regras da auditoria

1. **Medir, nunca supor.** Nenhum achado entra no relatório sem número medido em
   servidor rodando e navegador de verdade. "Parece lento" não é achado;
   "13 s para desenhar 3 de 9 quadros, 55 MB baixados" é.

2. **Reproduzir antes de corrigir.** Escreva o teste que falha primeiro. Se você
   não consegue reproduzir, diga isso em vez de corrigir no escuro.

3. **Medir de novo depois.** Sem o número do "depois", a correção é fé.

4. **Com dados do tamanho real.** A agência tem arquivos de **1 a 7 MB**, alguns
   de 11 MB, e tiras de carrossel que passam de 17.000px de largura. Testar com
   um PNG de 64 bytes não prova nada — todos os defeitos deste sistema só
   aparecem com peso.

5. **O código de resposta engana.** Uma rota pode responder 200 e não ter feito
   nada; um DELETE pode responder 200 e não ter apagado. Meça **no banco** e
   **na tela**, não no status.

6. **Quando o sintoma se repete, pare de tapar.** Se o mesmo problema aparece
   numa segunda tela, a pergunta deixa de ser "como conserto esta" e passa a ser
   "por que isto se repete". Foi o erro mais caro do dia: três rodadas
   consertando o mesmo defeito em lugares diferentes antes de olhar a forma dele.

7. **Corrigir não pode quebrar.** Rode a suíte inteira antes de cada commit.
   Se você quebrou algo, conserte antes de subir — nunca suba vermelho.

---

## O que "rápido" quer dizer aqui — os números

Estas são as metas. Um achado é qualquer coisa que as estoure.

| O quê | Meta | Como medir |
|---|---|---|
| Qualquer tela abrir | **conteúdo à vista desenhado em até 3 s** | navegador, rede normal |
| Grade com 12+ peças | **nada girando aos 5 s** | contar spinners |
| Peso para mostrar a primeira tela | **até 3 MB** | somar as respostas |
| Miniatura de grade | **até ~150 KB por quadro** | tamanho da resposta |
| Subir 1 arquivo de 5 MB | **até 15 s até aparecer na tela** | do clique ao quadro |
| Subir 10 arquivos de 5 MB | **até 60 s, com progresso visível** | idem |
| Cortar carrossel de 6 slides | **até 15 s** | do "Cortar" ao carrossel montado |
| Vídeo começar a tocar | **até 3 s, sem baixar o arquivo todo** | conferir resposta 206 |
| Segunda visita à mesma tela | **quase instantânea** (cache) | comparar com a primeira |

Onde a meta não se aplica, diga por quê em vez de ignorá-la.

---

## Armadilhas já conhecidas — confira que não voltaram

Cada uma destas custou tempo da agência. Elas são o teste de regressão da
auditoria: confira uma por uma, porque nenhuma dá erro na tela quando volta.

1. **Endereço vs. id.** A tela sabe o id do arquivo mas não o endereço dele, e
   cai em baixar o arquivo inteiro para desenhar um quadradinho. Apareceu em
   CINCO lugares. Sintoma: quadros em branco ou girando; a Galeria funcionando
   enquanto a Distribuição não.

2. **Resolução do arquivo vs. resolução do Instagram.** Cortar/guardar na
   resolução do arquivo gera 190 MB onde 5 MB bastam. O Instagram mostra a
   1080 de largura; acima disso só pesa.

3. **A conta que assume 1080.** `largura ÷ 1080` só acerta se a arte foi
   exportada em 1080 por slide. Quem exporta do Canva em 2x ou 3x recebe um
   número errado — e cortar por ele parte as slides ao meio. A conta certa
   olha o **formato** (a altura diz a largura de uma slide).

4. **Captura de quadro e domínio.** Mídia servida direto da nuvem é de outro
   domínio, e o navegador **proíbe** capturar quadro dela num canvas. Toda tela
   que captura (capa de vídeo, gerar miniatura) precisa do endereço do próprio
   servidor. Sintoma: "Não foi possível capturar o quadro", ou miniaturas que
   silenciosamente param de ser guardadas.

5. **Caminho de volta.** Todo caminho rápido precisa de um caminho de volta. Se
   o endereço direto não desenha (.HEIC de iPhone, arquivo movido), tem que
   baixar como antes — nunca desistir e escrever "sem arte" numa peça que tem
   arte.

6. **Assinatura instável.** Endereço assinado com a hora exata muda a cada
   pedido, e endereço novo é arquivo novo para o navegador: o cache é jogado
   fora a cada abrir de tela. Ancore a assinatura numa janela.

7. **Miniatura que nunca é guardada.** Se a tela desenha a arte cheia e não
   guarda a miniatura, ela vai rebaixar a arte cheia para sempre, a cada visita.

8. **Ordem que congela.** Ordenar por um campo salvo e só depois pela data faz
   a data perder o mando para sempre depois do primeiro arrastar. Sempre haja
   uma saída de volta.

---

## O caminho a percorrer

Percorra **como usuário**, na ordem, nas duas pontas. Em cada passo: cronometre,
conte o peso, conte o que girou, e olhe a tela.

### A — Entrar e o primeiro minuto
- [ ] Login da agência: quanto demora até a primeira tela útil?
- [ ] Dashboard: quantos pedidos, quanto peso, algo girando?
- [ ] Trocar de aba pela primeira vez — e pela segunda (o cache ajudou?)

### B — Galeria (é a porta de tudo)
- [ ] Abrir com um cliente que tem 100+ arquivos
- [ ] Subir 1 arquivo de 5 MB. E 10 de uma vez. Tem progresso? Dá para
      continuar trabalhando enquanto sobe? O que acontece se cair a internet no
      meio? E se o arquivo for grande demais — a mensagem diz o limite?
- [ ] Subir `.HEIC` de iPhone, `.mov`, vídeo de 100 MB, PDF, um arquivo que não
      é nenhum dos dois
- [ ] Navegar pastas, mover, renomear, apagar
- [ ] **Duplicatas**: subir o mesmo arquivo duas vezes cria dois? Deveria avisar?
- [ ] Baixar: vem o arquivo ORIGINAL, sem recompressão?

### C — Distribuição
- [ ] As quatro abas (Preparar, Para aprovação, Aprovados, Programados)
- [ ] As quatro visões (post, lista, perfil, calendário)
- [ ] Prévia do perfil: qualidade dos quadros (meça os pixels reais), ordem,
      arrastar, e a saída de volta à ordem por data
- [ ] Carrossel: tira larga e slides separadas; capa é sempre a 1ª; deslizar
- [ ] Cortar em slides: pela subida E pela galeria; a sugestão bate com a arte?
- [ ] Capa do vídeo: a tira de quadros monta? salva?
- [ ] Trocar arte, tirar arte, legenda, data
- [ ] Enviar para aprovação

### D — Área do Cliente (no CELULAR, é onde ele abre)
- [ ] Entrar; as 7 abas
- [ ] Aprovar, pedir ajuste, e a volta: reenviar e aprovar
- [ ] A arte chega? Em qualidade? Vídeo toca sem baixar tudo?
- [ ] Calendário e agenda no celular
- [ ] Pagamentos: em aberto x pago, recibo
- [ ] Contrato: abre, lê, assina
- [ ] O cliente sobe arquivo pela pasta dele

### E — O resto do sistema
- [ ] Clientes, Serviços, Prospecção, Central, Prioridades, Projetos, Tarefas
- [ ] Planejamento, Entregas, Financeiro, Metas, Agenda, Relatórios
- [ ] Inteligência, Onboarding, IA, Integrações, Usuários, Configurações
- [ ] Em cada uma: abre rápido? cabe no celular? tem erro no console?

---

## Como reportar

Para cada achado:

```
ONDE      a tela e o caminho exato
SINTOMA   o que a pessoa vê (a frase que ela usaria)
MEDIDO    o número, antes
CAUSA     a linha, e por que ninguém tinha percebido
CORREÇÃO  o que mudou
MEDIDO    o número, depois
```

**Gravidade:**
- **Grave** — perde dado, vaza dado, ou impede o trabalho de acontecer hoje
- **Sério** — custa minutos por dia, ou o cliente vê algo quebrado
- **Incômodo** — irrita, mas dá para viver
- **Falso positivo** — parecia defeito e não é. **Registre também**, com o
  porquê: já perdi tempo caçando um `{{cliente}}` que era a documentação dos
  marcadores na tela, e quase reportei 23 furos de segurança que eram rotas
  respondendo 200 sem tocar em nada.

---

## Ao corrigir

- Um assunto por commit, com o número medido na mensagem.
- Comentário em português explicando **por que** — quem lê depois precisa saber
  o que aconteceu, não o que a linha faz.
- Teste que falharia se o defeito voltasse.
- Suíte inteira verde antes de subir.
- Se você quebrou algo no caminho, diga na mensagem do commit. Foi você.
