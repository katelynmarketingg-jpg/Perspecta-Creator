// "A GALERIA SÓ IMPORTA ARQUIVO PEQUENO."
//
// Pedido dela: "verifica por que a galeria só importa arquivos se forem
// pequenos, tentei enviar arquivos grandes e não foram… o tamanho (2 min)
// provavelmente mais de 1 gb".
//
// O caminho do arquivo grande tem três portas, e nenhuma delas dizia nada
// quando fechava:
//
//   1. a nuvem (R2) está ligada? Se não, o arquivo vai para o disco do
//      servidor — 10 GB divididos com o banco. Um vídeo de 1 GB subia inteiro
//      pela internet dela e morria no fim, sem motivo na tela.
//   2. o bucket deixa o navegador entregar (CORS)? Se não, o envio direto
//      falha em silêncio e o sistema volta pelo caminho longo, que é
//      justamente o que não aguenta o grande.
//   3. a assinatura da entrega sai?
//
// Agora: a porta 1 é recusada ANTES do envio, com o número do espaço livre; e
// há um teste de um clique que bate nas três e diz qual está fechada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cabeNoDisco, FOLGA_DO_DISCO, espacoLivreNoDisco } from "../src/routes/files.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ler = (p) => readFileSync(join(RAIZ, p), "utf8");
const filesjs = ler("server/src/routes/files.js");
const teste = ler("client/src/upload/teste-de-envio.js");
const settings = ler("client/src/pages/Settings.jsx");

const GB = 1024 * 1024 * 1024;

test("o espaço livre do disco é um número de verdade", () => {
  const livre = espacoLivreNoDisco();
  assert.equal(typeof livre, "number");
  assert.ok(livre > 0, "o disco onde os uploads ficam tem de responder quanto sobrou");
});

test("vídeo de 1 GB em disco com 500 MB livres é recusado NA HORA", () => {
  assert.equal(cabeNoDisco(1 * GB, 500 * 1024 * 1024), false);
  assert.equal(cabeNoDisco(1 * GB, 5 * GB), true);
});

test("a folga do banco é respeitada: o que cabe raspando não cabe", () => {
  const livre = 1 * GB;
  assert.equal(cabeNoDisco(livre - FOLGA_DO_DISCO, livre), true);
  assert.equal(cabeNoDisco(livre - FOLGA_DO_DISCO + 1, livre), false,
    "o banco vive no mesmo disco — encher até a última gota derruba tudo");
});

test("sem saber o espaço livre, não barra ninguém", () => {
  assert.equal(cabeNoDisco(1 * GB, null), true);
  assert.equal(cabeNoDisco(1 * GB, undefined), true);
});

test("a recusa diz o espaço livre e manda ligar a nuvem", () => {
  assert.match(filesjs, /if \(!cabeNoDisco\(maior, livre\)\)/);
  assert.match(filesjs, /status\(413\)/);
  assert.match(filesjs, /Configurações → Armazenamento/,
    "recusa sem caminho de saída é só um 'não' — tem de dizer onde se resolve");
  assert.match(filesjs, /sem_nuvem: true, livre/);
});

test("a conferência de armazenamento mostra o espaço livre e o teto", () => {
  assert.match(filesjs, /livre_no_disco: espacoLivreNoDisco\(\)/);
  assert.match(filesjs, /limite_por_arquivo: MAX_ARQUIVO/);
  assert.match(settings, /Livre no disco/);
  assert.match(settings, /Teto por arquivo/);
});

test("o teste de envio percorre as três portas e nomeia a do CORS", () => {
  assert.match(teste, /upload-direto\/autorizar/, "porta 1: a nuvem autoriza?");
  assert.match(teste, /CORS do bucket/, "porta 2: o navegador consegue entregar?");
  assert.match(teste, /api\/files\/upload/, "porta 3: e pelo servidor, funciona?");
  assert.match(teste, /caminho: "nuvem"/);
  assert.match(teste, /caminho: "servidor"/);
});

test("o teste apaga o que criou — galeria não fica com lixo", () => {
  assert.match(teste, /api\.delete\(`\/files\/\$\{id\}`\)/);
  assert.match(teste, /await limpar\(criados\);/);
});

test("quando a nuvem falha, o teste NÃO disfarça caindo para o servidor", () => {
  assert.match(teste, /Não cai para o servidor: aqui o objetivo é DESCOBRIR/,
    "o envio de verdade tem de tentar os dois; o diagnóstico, não — senão esconde a porta fechada");
});

test("o botão do teste está na tela dela, com a barra de progresso", () => {
  assert.match(settings, /testarEnvio/);
  assert.match(settings, /Testar com 12 MB/);
  assert.match(settings, /Testar com 150 MB/);
  assert.match(settings, /value=\{pct\}/);
});

test("com a nuvem desligada, a tela avisa que o disco é o teto", () => {
  assert.match(settings, /!d\.r2_ligado && d\.livre_no_disco != null/);
  assert.match(settings, /Vídeo de 2 minutos/);
});
