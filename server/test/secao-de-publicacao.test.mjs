// A SEÇÃO DE PUBLICAÇÃO SOME SEM EXPLICAR.
//
// Pergunta dela: "na distribuição aparece a aba de publicar no Instagram,
// independente se tem uma integração, daí aparece a mensagem de criar uma
// integração... porém, essa mensagem só aparece no slide ou em vídeo, mas não
// aparece no post. Por que que tá acontecendo isso?"
//
// Reproduzido no navegador, com post, carrossel e reel DO MESMO CLIENTE: os
// três se comportavam igual. Não era o tipo da peça — era o ESTADO dela.
//
// A seção inteira só existia para peça APROVADA. Numa peça ainda não aprovada
// ela simplesmente não aparecia, sem uma linha dizendo por quê; e numa peça já
// postada aparecia o "Postado ✓" no lugar do aviso. Como os posts dela
// costumam estar num desses dois estados e os carrosséis no outro, parecia
// depender do tipo.
//
// Sumir sem explicar é pior do que botão desligado: agora a seção está sempre
// ali, em um de três estados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tela = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/Distribution.jsx"), "utf8");

const secao = tela.slice(
  tela.indexOf("A SEÇÃO APARECE SEMPRE"),
  tela.indexOf("Reels com música do Edits: baixe"),
);

test("a seção não depende mais da aprovação para existir", () => {
  assert.ok(!/\{item\.approval_status === "approved" && \(/.test(tela),
    "era este portão: sem aprovação, a seção inteira sumia");
  assert.match(secao, /<Divider sx=\{\{ my: 0\.5 \}\}>Publicação<\/Divider>/);
});

test("peça não aprovada DIZ que está esperando a aprovação", () => {
  assert.match(secao, /item\.approval_status !== "approved" \?/);
  assert.match(secao, /só depois de aprovada/);
});

test("e diz em que pé está a aprovação, não só que falta", () => {
  assert.match(secao, /changes_requested/, "o cliente pediu ajustes");
  assert.match(secao, /"sent"/, "enviada, esperando");
  assert.match(secao, /ainda não foi enviada/, "nem foi enviada");
});

test("aprovada e sem Meta: continua avisando para conectar", () => {
  assert.match(tela, /ainda não tem o Instagram conectado/);
  assert.match(tela, /item\.meta_conectada \?/);
});

test("nada disso olha o tipo da peça — post, carrossel e reel são iguais", () => {
  // Se um dia alguém puser um "se for vídeo" aqui dentro, é bom o teste gritar:
  // foi justamente a assimetria aparente que a fez perguntar.
  assert.ok(!/content_type/.test(secao),
    "a seção de publicação não pode se comportar diferente por tipo");
  assert.ok(!/pecaEhVideo/.test(secao));
});
