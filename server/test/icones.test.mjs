// OS ÍCONES DO CREATOR.
//
// Pedido dela: "arruma pra nós o favicon do Perspecta Creator, que ele está
// errado, e o ícone que fica na tela do computador quando a gente instala o
// aplicativo, que ele está descentralizado".
//
// O achado: medindo os ícones antigos, as margens eram IGUAIS dos dois lados —
// já estavam centralizados pela caixa. O que desequilibra é a forma do próprio
// símbolo: o quadrante vazio fica em cima à esquerda, então o peso cai embaixo
// à direita (medido: 11,2% da largura e 8,1% da altura fora do meio).
//
// Por isso a centralizagem passou a ser ÓPTICA, e por isso ela é gerada por um
// script e não recortada na mão.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PUB = join(RAIZ, "client/public");

/** Lado do PNG, lido do cabeçalho (IHDR) — não precisa decodificar a imagem. */
function tamanhoDoPng(caminho) {
  const b = readFileSync(caminho);
  assert.equal(b.toString("ascii", 1, 4), "PNG", `${caminho} não é PNG`);
  return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
}

const ESPERADOS = [
  ["favicon-32.png", 32], ["favicon-64.png", 64], ["apple-touch-icon.png", 180],
  ["icon-192.png", 192], ["icon-512.png", 512], ["icon-maskable.png", 512],
];

test("todos os ícones existem, quadrados e no tamanho que o nome promete", () => {
  for (const [nome, lado] of ESPERADOS) {
    const caminho = join(PUB, nome);
    assert.ok(existsSync(caminho), `falta ${nome}`);
    const t = tamanhoDoPng(caminho);
    assert.equal(t.largura, lado, `${nome} largura`);
    assert.equal(t.altura, lado, `${nome} altura — ícone tem de ser quadrado`);
  }
});

test("o manifest e o index apontam para eles", () => {
  const man = JSON.parse(readFileSync(join(PUB, "manifest.webmanifest"), "utf8"));
  const src = man.icons.map((i) => i.src);
  for (const n of ["/icon-192.png", "/icon-512.png", "/icon-maskable.png"]) {
    assert.ok(src.includes(n), `o manifest não cita ${n}`);
  }
  assert.ok(man.icons.some((i) => i.purpose === "maskable"),
    "sem maskable, o Android recorta o ícone comum e come a marca");

  const html = readFileSync(join(RAIZ, "client/index.html"), "utf8");
  for (const n of ["favicon-32.png", "favicon-64.png", "apple-touch-icon.png"]) {
    assert.match(html, new RegExp(n.replace(".", "\\.")), `o index não cita ${n}`);
  }
});

test("a versão do cache subiu — senão quem instalou fica com o ícone velho", () => {
  // O caminho do ícone não leva hash: é o service worker que decide se o
  // arquivo novo chega. Esta é a única coisa que faz a troca acontecer de fato.
  const sw = readFileSync(join(PUB, "sw.js"), "utf8");
  const m = sw.match(/const CACHE = "perspecta-v(\d+)"/);
  assert.ok(m, "o nome do cache mudou de formato");
  assert.ok(Number(m[1]) >= 4, `cache está em v${m[1]}, e os ícones mudaram na v4`);
});

test("o gerador existe, e centraliza pelo peso — não pela caixa", () => {
  const js = readFileSync(join(RAIZ, "scripts/gerar-icones.mjs"), "utf8");
  assert.match(js, /sx \+= xx \* a/, "soma ponderada: é como se acha o centro de massa");
  assert.match(js, /- foraX/);
  assert.match(js, /- foraY/);
  assert.match(js, /MARGEM_MINIMA/,
    "o empurrão não pode encostar na borda: marca cortada parece defeito");
  assert.match(js, /purpose|maskable|0\.52/,
    "o maskable precisa caber na zona segura do recorte do sistema");
});
