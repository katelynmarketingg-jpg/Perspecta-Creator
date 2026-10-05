// A ORDEM DO PERFIL, E O QUE SAI DELA.
//
// A lógica do Instagram, nas palavras dela: "debaixo pra cima, da direita pra
// esquerda. O bem da direita e bem debaixo é o mais antigo; o bem da esquerda e
// bem de cima é o último postado."
//
// Três coisas neste arquivo:
//   1. peça SEM DATA fica em cima — "os que eu subi agora aparecem sem data,
//      estão bem embaixo, acabaram com a ordem; deveriam estar lá em cima";
//   2. arrastar de baixo para cima EMPURRA para a direita quem estava lá, em
//      vez de trocar de lugar com ele;
//   3. marcar "já foi postado" tira a peça da grade — sem o resto perder a ordem.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const { ordenarFeed, reencaixar, aindaNoPerfil, jaEntrou, publicadaPeloSistema, marcadaNaMao } = await import("../../client/src/feed-ordem.js");
const tela = readFileSync(join(aqui, "../../client/src/pages/Distribution.jsx"), "utf8");

const ids = (lista) => lista.map((p) => p.id);

// --- 1. a ordem -------------------------------------------------------------

test("o mais recente vem primeiro (canto de cima à esquerda)", () => {
  const r = ordenarFeed([
    { id: 1, scheduled_at: "2026-09-22 16:38" },
    { id: 2, scheduled_at: "2026-10-06 16:44" },
    { id: 3, scheduled_at: "2026-09-30 16:36" },
  ]);
  assert.deepEqual(ids(r), [2, 3, 1]);
});

test("peça SEM DATA fica em cima, não no fim", () => {
  // É o que acabou de subir: ainda não tem hora marcada, mas é o próximo a ir
  // ao ar — não o mais antigo do perfil.
  const r = ordenarFeed([
    { id: 1, scheduled_at: "2026-09-30 16:36" },
    { id: 2, scheduled_at: null },
    { id: 3, scheduled_at: "2026-10-06 16:44" },
    { id: 4, scheduled_at: "" },
  ]);
  assert.deepEqual(ids(r).slice(0, 2).sort(), [2, 4], "as duas sem data abrem a grade");
  assert.deepEqual(ids(r).slice(2), [3, 1], "e o resto segue a data, mais recente primeiro");
});

test("quem foi arrumada à mão manda sobre a data", () => {
  const r = ordenarFeed([
    { id: 1, position: 2, scheduled_at: "2026-10-06 16:44" },
    { id: 2, position: 1, scheduled_at: "2026-09-01 10:00" },
    { id: 3, scheduled_at: "2026-10-10 10:00" },
  ]);
  assert.deepEqual(ids(r), [2, 1, 3], "as arrumadas primeiro, na ordem delas");
});

test("a ordem é sempre a mesma — sem peça trocando de lugar sozinha", () => {
  // Sem desempate, duas peças com a mesma data (ou duas sem data) ficavam em
  // ordem imprevisível: a comparação nunca devolvia zero.
  const lista = [
    { id: 7, scheduled_at: "2026-09-30 16:36" },
    { id: 9, scheduled_at: "2026-09-30 16:36" },
    { id: 8, scheduled_at: "2026-09-30 16:36" },
  ];
  const uma = ids(ordenarFeed(lista));
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(ids(ordenarFeed([...lista].reverse())), uma, "mesma lista, mesma ordem");
  }
});

test("ordenar não estraga a lista que recebeu", () => {
  const lista = [{ id: 1, scheduled_at: "2026-01-01" }, { id: 2, scheduled_at: "2026-02-01" }];
  ordenarFeed(lista);
  assert.deepEqual(ids(lista), [1, 2]);
});

// --- 2. o arrasto -----------------------------------------------------------

test("arrastar de baixo para cima empurra para a DIREITA quem estava lá", () => {
  // Grade de 3 colunas: [0,1,2] em cima, [3,4,5] no meio, [6,7,8] embaixo.
  const grade = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: n }));
  // Levo o de baixo (id 7) para o segundo lugar da primeira linha (índice 1).
  const r = ids(reencaixar(grade, 7, 1));
  assert.equal(r[1], 7, "a arrastada assume o lugar onde foi solta");
  assert.equal(r[2], 1, "quem estava ali andou UM para a direita — virou mais antigo");
  assert.deepEqual(r, [0, 7, 1, 2, 3, 4, 5, 6, 8], "e o resto anda junto, sem buraco");
});

test("é encaixe, não troca", () => {
  const grade = [0, 1, 2, 3].map((n) => ({ id: n }));
  const r = ids(reencaixar(grade, 3, 0));
  assert.deepEqual(r, [3, 0, 1, 2]);
  assert.notDeepEqual(r, [3, 1, 2, 0], "trocar de lugar deixaria a arrastada e a outra invertidas");
});

test("arrastar de cima para baixo também funciona", () => {
  const grade = [0, 1, 2, 3, 4].map((n) => ({ id: n }));
  assert.deepEqual(ids(reencaixar(grade, 0, 3)), [1, 2, 3, 0, 4]);
});

test("reencaixe sem efeito devolve a mesma lista", () => {
  const grade = [0, 1, 2].map((n) => ({ id: n }));
  assert.equal(reencaixar(grade, 1, 1), grade, "mesmo lugar");
  assert.equal(reencaixar(grade, 9, 0), grade, "índice que não existe");
  assert.deepEqual(ids(reencaixar(grade, 0, 99)), [1, 2, 0], "destino além do fim cai no fim");
});

// --- 3. o que já foi postado ------------------------------------------------

// ESTE CASO MUDOU DUAS VEZES, NO MESMO DIA, A PEDIDO DELA.
//
// 1) Antes, QUALQUER peça publicada saía da grade — inclusive a que o sistema
//    tinha acabado de publicar. Sumir era a única notícia de que deu certo.
// 2) Depois, ela separou as duas ideias de vez: "o laranja é pra tirar da
//    grade, porque pode já ter sido postado e ainda assim eu não querer tirar
//    dali".
//
// Então hoje: ter sido postado NÃO esconde nada. Só o botão laranja esconde.
test("ter sido postado não tira a peça da grade — nem à mão, nem pelo sistema", () => {
  const lista = [
    { id: 1, position: 1 },
    { id: 2, position: 2, published_at: "2026-09-20 10:00", external_post_id: "manual" },
    { id: 3, position: 3, published_at: "2026-10-05 15:25", external_post_id: "17900000001" },
  ];
  assert.deepEqual(ids(aindaNoPerfil(lista)), [1, 2, 3], "o perfil mostra o que está no perfil");
});

test("só sai da grade o que ela mandou sair — e o resto não perde a ordem", () => {
  const lista = [
    { id: 1, position: 1 },
    { id: 2, position: 2, saiu_da_grade_em: "2026-10-05 20:00" },
    { id: 3, position: 3 },
  ];
  const r = aindaNoPerfil(lista);
  assert.deepEqual(ids(r), [1, 3]);
  assert.deepEqual(r.map((p) => p.position), [1, 3], "as posições das outras ficam como estavam");
});

test("sair da grade vale mesmo para o que nunca foi postado", () => {
  // É uma decisão de composição do perfil, não um estado da publicação.
  assert.deepEqual(aindaNoPerfil([{ id: 7, saiu_da_grade_em: "2026-10-05 20:00" }]), []);
});

test("as perguntas são três, e separadas", () => {
  const doSistema = { published_at: "2026-10-05 15:25", external_post_id: "179000" };
  const daMao = { published_at: "2026-10-05 15:25", external_post_id: "manual" };
  assert.equal(jaEntrou(doSistema), true);
  assert.equal(jaEntrou(daMao), true);
  assert.equal(jaEntrou({}), false);
  assert.equal(publicadaPeloSistema(doSistema), true);
  assert.equal(publicadaPeloSistema(daMao), false);
  assert.equal(marcadaNaMao(daMao), true, "só esta dá para desmarcar");
  assert.equal(marcadaNaMao(doSistema), false);
});

test("a grade do perfil de fato usa a regra", () => {
  assert.match(tela, /ordenarFeed\(aindaNoPerfil\(\[\.\.\.map\.values\(\)\]\)\)/);
});

test("o certinho conta se entrou; o laranja tira da grade", () => {
  const trecho = tela.slice(tela.indexOf("OS DOIS BOT"), tela.indexOf("position: \"absolute\", bottom: 0, left: 0"));

  // o laranja
  assert.match(trecho, /bgcolor: "warning\.main"/, "é laranja");
  assert.match(trecho, /onSairDaGrade\(p\)/);
  assert.match(trecho, /Tirar da grade do perfil/);

  // o certinho, nos dois estados
  assert.match(trecho, /jaEntrou\(p\) \?/, "cheio ou vazado depende de ter entrado");
  assert.match(trecho, /bgcolor: "success\.main"/, "entrou: verde cheio");
  assert.match(trecho, /color: "success\.main"/, "ainda não: verde vazado");
  assert.match(trecho, /onMarcarPostado\(p, true\)/, "o vazado é para ela marcar");

  assert.match(trecho, /e\.stopPropagation\(\)/, "clicar neles não abre a peça");
  assert.match(tela, /mark-posted`, \{ posted: postado \}/);
});

test("sem data ou hora passada é LARANJA, não vermelho", () => {
  // Não é erro: é peça que já era para ter ido ao ar. O laranja combina com o
  // certinho que confirma que ela entrou.
  const grade = tela.slice(tela.indexOf("function ReorderableFeed"), tela.indexOf("export default function Distribution"));
  assert.match(grade, /outlineColor: "warning\.main"/);
  assert.match(grade, /bgcolor: errada\(p\) \? "warning\.main"/);
  assert.ok(!/outlineColor: "error\.main"/.test(grade), "o contorno vermelho saiu");
  assert.ok(!/bgcolor: errada\(p\) \? "error\.main"/.test(grade), "a tarja vermelha saiu");
});

test("no seletor, a laranja fica ao lado da verde", () => {
  const seletor = tela.slice(tela.indexOf("function GalleryPicker"), tela.indexOf("ESCOLHER A CAPA DO VÍDEO"));
  assert.match(seletor, /const jaPostado = laminas \? laminas\.some\(\(l\) => l\.ja_postado\) : f\.ja_postado/);
  assert.match(seletor, /Esse post já foi ao ar/);
});

// --- a grade começa mais para cima ------------------------------------------

test("o texto comprido virou uma linha — a grade sobe", () => {
  assert.ok(!/Arraste para organizar \(encaixa entre um e\s*\n\s*outro\)/.test(tela),
    "o parágrafo que empurrava a grade para baixo saiu");
  assert.match(tela, /O último postado em cima à esquerda\. Arraste para organizar\./);
  assert.match(tela, /como funciona/, "o detalhe continua, no repousar do mouse");
  assert.match(tela, /maxWidth: 460/, "e a grade ficou maior");
});
