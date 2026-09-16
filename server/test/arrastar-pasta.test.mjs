// ARRASTAR UMA PASTA INTEIRA PARA DENTRO DA GALERIA.
//
// É assim que o material de um mês chega: uma pasta com dezenas de fotos. O
// navegador entrega isso por uma API de "entradas" (webkitGetAsEntry) com duas
// armadilhas conhecidas:
//
//   1. `readEntries` devolve no MÁXIMO 100 itens por chamada. Quem lê uma vez
//      só perde tudo depois da centésima foto — e perde EM SILÊNCIO;
//   2. pasta de Mac e de Windows vem com arquivo oculto junto (.DS_Store,
//      Thumbs.db), que não é material de ninguém.
//
// Aqui a leitura é testada sem navegador, com uma API de entradas de mentira.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const fonte = readFileSync(join(aqui, "../../client/src/upload/arrastar.js"), "utf8")
  .replace(/export const/g, "const").replace(/export function/g, "function").replace(/export async function/g, "async function");
const { arquivosSoltos, MAX_DE_UMA_VEZ } = await import(
  `data:text/javascript;base64,${Buffer.from(`${fonte}\nexport { arquivosSoltos, MAX_DE_UMA_VEZ };`).toString("base64")}`
);

/** Uma "entrada" de arquivo, como o navegador entrega. */
const arquivo = (nome) => ({
  isFile: true, isDirectory: false, name: nome,
  file: (ok) => ok({ name: nome, size: 10 }),
});

/** Uma "entrada" de pasta. readEntries entrega no máximo 100 por chamada. */
const pasta = (nome, filhos) => ({
  isFile: false, isDirectory: true, name: nome,
  createReader() {
    let i = 0;
    return {
      readEntries(ok) {
        const lote = filhos.slice(i, i + 100);
        i += lote.length;
        ok(lote);
      },
    };
  },
});

const soltando = (entradas) => ({
  items: entradas.map((e) => ({ kind: "file", webkitGetAsEntry: () => e })),
  files: [],
});

test("arquivos soltos soltos entram todos", async () => {
  const r = await arquivosSoltos(soltando([arquivo("a.png"), arquivo("b.png"), arquivo("c.png")]));
  assert.deepEqual(r.map((f) => f.name), ["a.png", "b.png", "c.png"]);
});

test("pasta arrastada é aberta, e as de dentro também", async () => {
  const arvore = pasta("Setembro", [
    arquivo("capa.png"),
    pasta("Stories", [arquivo("s1.png"), arquivo("s2.png")]),
    arquivo("post.png"),
  ]);
  const r = await arquivosSoltos(soltando([arvore]));
  assert.deepEqual(r.map((f) => f.name).sort(), ["capa.png", "post.png", "s1.png", "s2.png"]);
});

test("pasta com mais de 100 fotos vem INTEIRA", async () => {
  // A armadilha: readEntries entrega 100 por vez. Lendo uma vez só, as fotos
  // 101 em diante sumiriam sem ninguém perceber.
  const muitas = Array.from({ length: 150 }, (_, i) => arquivo(`foto-${String(i + 1).padStart(3, "0")}.png`));
  const r = await arquivosSoltos(soltando([pasta("Mês cheio", muitas)]));
  assert.equal(r.length, 150, `veio ${r.length} de 150`);
  assert.ok(r.some((f) => f.name === "foto-150.png"), "a última foto tem que estar lá");
});

test("arquivo oculto do sistema não entra na galeria dela", async () => {
  const r = await arquivosSoltos(soltando([pasta("Setembro", [
    arquivo(".DS_Store"), arquivo("Thumbs.db"), arquivo("arte.png"),
  ])]));
  assert.deepEqual(r.map((f) => f.name), ["arte.png"]);
});

test("tem um teto, para uma pasta gigante não travar o navegador", async () => {
  const muitas = Array.from({ length: MAX_DE_UMA_VEZ + 80 }, (_, i) => arquivo(`f${i}.png`));
  const r = await arquivosSoltos(soltando([pasta("Tudo", muitas)]));
  assert.equal(r.length, MAX_DE_UMA_VEZ);
});

test("navegador sem a API de entradas ainda envia os arquivos soltos", async () => {
  const r = await arquivosSoltos({ items: [], files: [{ name: "a.png" }, { name: "b.png" }] });
  assert.deepEqual(r.map((f) => f.name), ["a.png", "b.png"]);
});

test("soltar sem nada não quebra", async () => {
  assert.deepEqual(await arquivosSoltos(null), []);
  assert.deepEqual(await arquivosSoltos({ items: [], files: [] }), []);
});
