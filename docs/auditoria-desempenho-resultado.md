# Resultado da auditoria de desempenho

Executada em 14/09/2026, seguindo `auditoria-desempenho.md`. Tudo medido com
servidor de verdade e Chromium de verdade — nada aqui é estimativa.

Onde o número for de arte, ela é uma arte de post real (1080×1350, fundo
chapado com texto grande, ~1,4 MB em PNG). Ruído aleatório, que foi o que usei
numa primeira rodada, é o pior caso possível do PNG e daria números inflados;
está anotado onde isso aconteceu.

---

## O placar

| | antes | depois |
|---|---|---|
| Área do cliente: primeiro pixel no celular | **14,9 s** (tela branca) | **112 ms** |
| Área do cliente: programa baixado para entrar | 1,58 MB | 736 KB |
| Área do cliente: lista de aprovações | 11,13 MB de arte | **101 KB** |
| Distribuição: prévia do perfil (9 peças) | 12,63 MB | **0,22 MB** |
| Galeria: abrir um cliente com 120 arquivos | 3.750 KB em 3 pedidos | **1.252 KB em 1** |
| Baixar arquivo da nuvem | não respondia nunca | 302 assinado, na hora |
| Subir 10 arquivos (esperas de rede) | ~1,2 s em fila | ~0,4 s |
| Miniatura guardada por arquivo | 36 KB | 20 KB |

As 24 telas do sistema, no computador e no celular: conteúdo na tela entre
**118 e 212 ms**, sem bolinha rodando, sem erro no console, sem imagem
quebrada e sem rolagem lateral no celular.

---

## Graves

### 1. O botão de baixar arquivo não respondia
**ONDE** Galeria → qualquer arquivo → Baixar. E o link público da arte (o que a
Meta usa para publicar).
**SINTOMA** "Cliquei e não acontece nada, fica rodando."
**MEDIDO** Nenhuma resposta. Nunca. O navegador desistia por conta própria.
**CAUSA** `enderecoAssinado` não estava importada em `routes/files.js`. Como
todos os arquivos dela estão na nuvem, a rota caía nesse caminho, estourava
`ReferenceError`, o erro sumia numa promessa sem dono e a resposta nunca saía.
Ninguém tinha percebido porque numa instalação sem R2 esse caminho nem roda.
**CORREÇÃO** O import. E, junto, o Express passou a enxergar erro em rota
`async` (`promessa-solta.js`): daqui em diante rota que estoura **responde**
500, em vez de deixar a tela girando calada.
**MEDIDO** 302 com o endereço assinado, imediato.

### 2. A fonte segurava a tela inteira do cliente
**ONDE** Área do Cliente, no celular.
**SINTOMA** "Abri o link e ficou branco."
**MEDIDO** 14,9 segundos de tela branca até aparecer o campo de login, com a
rede ruim (que é a situação do celular com dados móveis).
**CAUSA** O `<link>` da fonte do Google no `<head>` é folha de estilo, e folha
de estilo **bloqueia o desenho**: o navegador não pinta um pixel enquanto ela
não chega — de outro domínio, com DNS e TLS pelo caminho.
**CORREÇÃO** Carregada sem bloquear (`media="print"` + `onload`). O texto
aparece na hora, na fonte do sistema, e a fonte bonita entra quando chega.
**MEDIDO** Primeiro pixel em 112 ms; campo de login em 129 ms.

### 3. Apagar pasta deixava arquivo na nuvem para sempre
**ONDE** Galeria → pasta → excluir.
**SINTOMA** Nenhum. É esse o problema: ninguém via.
**MEDIDO** Apagar uma pasta com uma subpasta dentro deixava o arquivo da
subpasta ocupando espaço no R2, sem nenhum jeito de chegar nele.
**CAUSA** A rota só apagava de verdade os arquivos soltos na pasta escolhida.
Os de subpasta sumiam do banco por cascata e os bytes ficavam. E a remoção era
disparada sem `await`: a resposta dizia "ok" antes de ela começar.
**CORREÇÃO** A árvore inteira, com `await`, e a resposta diz quantos arquivos
foram removidos. O aviso na tela avisa que subpastas vão junto e que não dá
para desfazer.

---

## Sérios

### 4. A prévia do perfil baixava a arte original de cada peça
**MEDIDO** 12,63 MB com nove peças (38 MB numa primeira medição com ruído, que
não vale). Cada quadrado tem ~250 px na tela.
**CAUSA** Não havia meio-termo: ou a miniatura de 480 px (que deixou a prévia
embaçada da outra vez) ou o arquivo inteiro.
**CORREÇÃO** A **prévia**: 1080 px de largura, a mesma que a Meta publica,
~36 KB. Gerada no navegador ao enviar; arte antiga ganha a dela em segundo
plano, na primeira vez que aparece na tela.
**MEDIDO** 0,22 MB, com densidade 3,47 — mais do triplo dos pixeis que a tela
usa. A nitidez é a mesma.

### 5. A lista de aprovações do cliente puxava a arte original
**MEDIDO** 11,13 MB para oito aprovações, nos dados móveis dele.
**CORREÇÃO** Usa a prévia, e só desenha o que está à vista. O botão "Baixar na
qualidade original" continua entregando o arquivo intacto.
**MEDIDO** 101 KB.

### 6. Abrir um cliente na Galeria pedia a mesma lista três vezes
**MEDIDO** 3.750 KB para desenhar uma tela só (a lista de um cliente com 120
arquivos tem 1,25 MB, porque leva a miniatura embutida).
**CAUSA** Dois problemas somados: três efeitos pedindo quase juntos, e o aviso
ao vivo saindo de rotas que **não gravam nada** — a que garante as pastas
padrão (um POST, chamado toda vez que se abre um cliente) e a que guarda
miniatura e prévia, disparada por cada quadradinho da grade. Cada aviso manda
todas as telas abertas **do escritório inteiro** recarregar.
**MEDIDO** 1.252 KB num pedido só.

### 7. O cliente baixava o sistema inteiro para ver a tela dele
**MEDIDO** 1,58 MB de programa (as 30 telas da agência num pacote só, gráficos
inclusive) para mostrar um campo de login.
**CORREÇÃO** Cada tela é um arquivo à parte, baixado quando abre.
**MEDIDO** 736 KB.

### 8. Subir arquivo era uma fila
**CAUSA** O servidor mandava um arquivo por vez para a nuvem. Dez fotos eram
dez esperas de rede enfileiradas, com a barra parada em 100%. Um `.zip` de 200
fotos, 200 esperas dentro de um pedido só.
**CORREÇÃO** Quatro sobem juntos, preservando a ordem.
**MEDIDO** Dez esperas de 120 ms: ~1,2 s → ~0,4 s.

### 9. A conta do corte de carrossel
Quatro defeitos na mesma conta: o número 1 era descartado (um post normal era
anunciado como "2 slides", um quadrado saía rotulado "9:16 story"); a certeza
era dividida pelo número de slides, fazendo encaixe porco parecer ótimo; a
mesma arte encaixa de mais de um jeito e isso não era dito; e a tela prometia
um tamanho de slide e entregava outro.

### 10. O aviso "você tem N para aprovar" mentia
Era escrito quando a agência mandava a peça e nunca mais mexido. O cliente
aprovava, a lista caía para 7, o aviso seguia dizendo 8 — dois números
diferentes na mesma tela.

---

## Incômodos

- **Nome do arquivo baixado** saía escapado: `arte%20final%20de%20setembro.png`.
- **Arquivo repetido** entrava sem avisar — é o que enchia a galeria de
  "1.png", "2.png". Agora o envio não é bloqueado (às vezes é de propósito),
  mas o painel mostra "já havia uma igual nesta pasta".
- **O card grande da Distribuição** mostrava a miniatura de 480 px numa caixa
  de 900 px e parava ali: o post ficava borrado onde ela olha para decidir.
- **A Galeria não usava o endereço direto da Cloudflare** — faltava uma coluna
  no SELECT, então toda foto passava por dentro do Render.

---

## Erro meu, corrigido

**O conserto da capa do vídeo só funcionava sem a nuvem.** Quando a captura do
quadro quebrou (por eu ter mandado a mídia direto para a Cloudflare), criei uma
rota que devolve um endereço do nosso domínio e dei o assunto por encerrado —
testando numa instalação sem R2, onde tudo passa pelo servidor de qualquer
jeito.

Medido depois, no Chromium: um `<img>`/`<video>` que **segue um
redirecionamento** para outro domínio suja o canvas do mesmo jeito. Não adianta
o endereço começar aqui; é o destino que conta. Na instância dela, com os 121
arquivos no R2, capturar o quadro continuava quebrado.

Isso também mataria a prévia das artes antigas — que são justamente essas 121.
Agora existe um bilhete marcado "para capturar", com os bytes passando por
dentro do servidor, sem redirecionar.

**Lição:** medir no ambiente que se parece com o dela, não no que é mais fácil
de subir. A diferença entre os dois foi o defeito inteiro.

---

## Falsos positivos (registrados de propósito)

- **O quadro vazio no carrossel.** Parecia peça sem arte; era o carregamento
  preguiçoso ainda não disparado no meu teste. A arte carrega ao rolar.
- **Metas no celular.** A varredura marcou como problema por ter pouco texto na
  tela. A tela abre certa — só não há meta cadastrada no banco de teste. Quem
  estourou o prazo foi o meu teste, esperando texto que não ia aparecer.
- **O botão "Enviar para a agência" travado.** Meu teste escrevia no campo
  espelho do MUI, não no campo real. Digitando de verdade, ele habilita.
- **As abas vazias da área do cliente**, na primeira rodada: falta de dado no
  banco de teste, não defeito.
- **Uma arte de 4,2 MB.** Minha primeira arte de teste era ruído aleatório — o
  pior caso possível do PNG. Uma arte de post de verdade do mesmo tamanho pesa
  1,4 MB. Os números de "antes" foram refeitos com arte realista.
- **Servidor velho.** Meus restarts estavam falhando em silêncio e eu medi
  código antigo por um tempo, concluindo que uma correção "não tinha
  funcionado". Tinha.

---

## O que continua valendo como está

- Baixar devolve o arquivo **byte a byte idêntico** ao original (sha256 igual).
  Nenhuma recompressão, em nenhum caminho.
- `.HEIC`, `.mov`, PDF e planilha entram sem erro.
- O envio já roda em segundo plano, três de cada vez, com barra por arquivo e
  mensagem em português quando a conexão cai.
- A capa do vídeo monta a tira de 8 quadros, deixa escolher e salva.
- Arrastar na prévia do perfil guarda a ordem e **não mexe nas datas**, com a
  saída "Voltar à ordem por data" funcionando.
- As 24 telas abrem entre 118 e 212 ms, no computador e no celular.
