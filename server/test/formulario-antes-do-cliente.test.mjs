// "MELHORA ALI PRO FORMULÁRIO SER ANTES DE ESCOLHER O CLIENTE, POR FAVOR
//  E QUERO QUE TU MELHORE PRA QUE FIQUE MAIS ORGANIZADO."
//
// Havia dois caminhos para abrir um onboarding, e eles contavam histórias
// diferentes. Pela aba Formulários, ela escolhia o formulário e o cliente
// depois. Pela aba Clientes, o cliente já vinha decidido — escondido no título
// da janela — e ela só descobria qual formulário ele ia receber no meio do
// caminho. E o botão "Abrir para um cliente" só existia em formulário COM
// NOME: quem usava o padrão da casa (que é a maioria) tinha de voltar para a
// outra aba.
//
// Agora a ordem é a mesma nos dois: primeiro o que é (serviço e formulário),
// depois para quem — com o cliente já escolhido quando ela veio clicando nele,
// e ainda assim trocável. E a janela, que era uma coluna só de campos do
// serviço às observações, virou seis blocos numerados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "../..");
const tela = readFileSync(join(RAIZ, "client/src/pages/Onboarding.jsx"), "utf8");

test("o formulário vem antes do cliente, na tela e no código", () => {
  const dialogo = tela.slice(tela.indexOf("function FormularioOnboarding"), tela.indexOf("function partesVig"));
  const formulario = dialogo.indexOf('label="Formulário que ele vai responder"');
  const cliente = dialogo.indexOf('label="Para qual cliente"');
  assert.ok(formulario > 0 && cliente > 0, "os dois campos têm de existir");
  assert.ok(formulario < cliente,
    "o cliente não pode ser perguntado antes de ela dizer o que ele vai responder");
});

test("o cliente é um campo nos dois caminhos — e vem preenchido quando ela clicou nele", () => {
  assert.match(tela, /const escolheCliente = !jaExiste;/,
    "antes o campo só aparecia quando ela abria pelo formulário");
  // Clicar no cliente continua levando o cliente junto: o campo nasce com ele.
  assert.match(tela, /setAbrindo\(\{ cliente: c \}\)/);
  assert.match(tela, /client_id: cliente\?\.id \|\| ""/);
});

test("onboarding que já existe não troca de dono", () => {
  // O link já foi mandado: trocar o cliente aqui faria o contrato de um sair
  // com o nome de outro.
  const dialogo = tela.slice(tela.indexOf("function FormularioOnboarding"), tela.indexOf("function partesVig"));
  assert.match(dialogo, /o link deste onboarding é dele/);
});

test("a janela está dividida em blocos numerados, na ordem do trabalho", () => {
  const blocos = [...tela.matchAll(/<Secao numero=\{(\d)\} titulo="([^"]+)"/g)]
    .map((m) => [Number(m[1]), m[2]]);
  assert.deepEqual(blocos, [
    [1, "O que é"],
    [2, "Para quem"],
    [3, "O que foi combinado"],
    [4, "Vigência e datas"],
    [5, "Na hora de assinar"],
    [6, "Suas anotações"],
  ]);
});

test("o padrão da casa também pode ser mandado para um cliente", () => {
  const estante = tela.slice(tela.indexOf("Novo formulário"), tela.indexOf("function PerguntasDoCliente"));
  const botao = estante.indexOf("Abrir para um cliente");
  const soComNome = estante.indexOf("{editando && form && (");
  assert.ok(botao > 0, "o botão de mandar para um cliente sumiu da estante");
  assert.ok(botao < soComNome,
    "o botão ficou de novo preso ao formulário com nome — o padrão da casa é o que mais se manda");
  assert.match(estante, /form_id: editando \|\| ""/);
});

test("campo vazio diz o que está valendo, em vez de ficar em branco", () => {
  // "— decidir depois —" e "Padrão da casa" são escolhas de verdade: sem
  // displayEmpty o campo aparecia vazio, como se ela não tivesse mexido.
  const dialogo = tela.slice(tela.indexOf("function FormularioOnboarding"), tela.indexOf("function partesVig"));
  assert.equal(dialogo.split("displayEmpty: true").length - 1, 3,
    "serviço, formulário e cliente precisam mostrar a opção escolhida");
});
