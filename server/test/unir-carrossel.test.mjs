// UNIR ARTES NUM CARROSSEL, ARRASTANDO UMA POR CIMA DA OUTRA.
//
// Pedido dela: "se eu segurar um e arrastar pra cima de outro, o que eu
// arrastar vira o segundo slide daquele post; se arrasto mais um, fica como o
// terceiro... e aí vai. Unifica." E depois: "daí o baixar baixa já separado
// como foi juntado — a diferença é que já vai como cortado".
//
// A ideia que faz as duas coisas serem verdade ao mesmo tempo: NADA é
// recortado nem regravado. Unir é pendurar uma etiqueta (quem é a capa, em que
// ordem vêm as outras). Cada lâmina continua sendo o arquivo original — por
// isso o baixar sai separado, e em alta.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-unir-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const files = (await import("../src/routes/files.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa de Unir',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@u.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Karen','active',?)").run(org).lastInsertRowid;
const pastaA = db.prepare("INSERT INTO folders (name,client_id,org_id) VALUES ('Editados',?,?)").run(cli, org).lastInsertRowid;
const pastaB = db.prepare("INSERT INTO folders (name,client_id,org_id) VALUES ('Aprovados',?,?)").run(cli, org).lastInsertRowid;

const arte = join(dir, "a.png");
writeFileSync(arte, Buffer.alloc(32, 1));
const novo = (nome, folder = pastaA, mime = "image/png") => db.prepare(
  `INSERT INTO files (folder_id,client_id,original_name,mime,size,stored_path,stage,org_id)
   VALUES (?,?,?,?,32,?,'editados',?)`
).run(folder, cli, nome, mime, arte, org).lastInsertRowid;

const app = express();
app.use(express.json({ limit: "8mb" }));
app.use("/api/files", files);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const porta = srv.address().port;
after(() => srv.close());

const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
const pedir = async (metodo, caminho, corpo) => {
  const r = await fetch(`http://127.0.0.1:${porta}${caminho}`, {
    method: metodo, headers: H,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};
const lerArquivo = (id) => db.prepare("SELECT * FROM files WHERE id = ?").get(id);

test("arrastar uma arte para cima de outra faz dela a segunda lâmina", async () => {
  const capa = novo("1.png"), segunda = novo("2.png");
  const r = await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [segunda] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.laminas.map((l) => l.id), [capa, segunda]);
  assert.equal(lerArquivo(capa).carrossel_pos, 1, "a capa é a lâmina 1");
  assert.equal(lerArquivo(segunda).carrossel_pos, 2, "a arrastada é a 2");
  assert.equal(lerArquivo(segunda).carrossel_id, capa);
});

test("arrastar mais uma continua a contagem: vira a terceira", async () => {
  const capa = novo("c1.png"), b = novo("c2.png"), c = novo("c3.png");
  await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [b] });
  const r = await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [c] });
  assert.deepEqual(r.corpo.laminas.map((l) => l.carrossel_pos), [1, 2, 3]);
  assert.deepEqual(r.corpo.laminas.map((l) => l.id), [capa, b, c]);
});

test("soltar em cima de uma lâmina do meio vale como soltar no post", async () => {
  const capa = novo("m1.png"), meio = novo("m2.png"), nova = novo("m3.png");
  await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [meio] });
  const r = await pedir("POST", `/api/files/${meio}/carrossel`, { ids: [nova] });
  assert.equal(r.corpo.capa_id, capa, "a capa continua sendo a primeira");
  assert.deepEqual(r.corpo.laminas.map((l) => l.id), [capa, meio, nova]);
});

test("as lâminas NÃO são recortadas nem regravadas — é só etiqueta", async () => {
  const capa = novo("q1.png"), b = novo("q2.png");
  const antes = [lerArquivo(capa), lerArquivo(b)].map((f) => ({ p: f.stored_path, s: f.size }));
  await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [b] });
  const depois = [lerArquivo(capa), lerArquivo(b)].map((f) => ({ p: f.stored_path, s: f.size }));
  assert.deepEqual(depois, antes, "o arquivo guardado é exatamente o mesmo");
  // E é por isso que baixar sai "já separado, já cortado": são dois arquivos.
  assert.equal(readFileSync(arte).length, 32);
});

test("arrastar um carrossel inteiro leva as lâminas dele junto, na ordem", async () => {
  const a1 = novo("a1.png"), a2 = novo("a2.png");
  const b1 = novo("b1.png"), b2 = novo("b2.png");
  await pedir("POST", `/api/files/${a1}/carrossel`, { ids: [a2] });
  await pedir("POST", `/api/files/${b1}/carrossel`, { ids: [b2] });
  const r = await pedir("POST", `/api/files/${a1}/carrossel`, { ids: [b1] });
  assert.deepEqual(r.corpo.laminas.map((l) => l.id), [a1, a2, b1, b2]);
});

test("soltar dentro do próprio post não duplica nem embaralha", async () => {
  const capa = novo("p1.png"), b = novo("p2.png");
  await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [b] });
  const r = await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [b] });
  assert.equal(r.status, 400, "não há o que unir");
  const laminas = db.prepare("SELECT id FROM files WHERE carrossel_id = ? ORDER BY carrossel_pos").all(capa);
  assert.deepEqual(laminas.map((l) => l.id), [capa, b]);
});

test("a lâmina acompanha a capa de pasta — post não fica partido em duas telas", async () => {
  const capa = novo("f1.png", pastaA), b = novo("f2.png", pastaB);
  await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [b] });
  assert.equal(lerArquivo(b).folder_id, pastaA);
});

test("documento não vira lâmina de post", async () => {
  const capa = novo("d1.png"), pdf = novo("contrato.pdf", pastaA, "application/pdf");
  const r = await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [pdf] });
  assert.equal(r.status, 400);
  assert.equal(lerArquivo(pdf).carrossel_id, null);
});

test("separar devolve cada lâmina como arquivo solto", async () => {
  const capa = novo("s1.png"), b = novo("s2.png"), c = novo("s3.png");
  await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [b, c] });
  const r = await pedir("DELETE", `/api/files/${capa}/carrossel`);
  assert.equal(r.status, 200);
  for (const id of [capa, b, c]) assert.equal(lerArquivo(id).carrossel_id, null);
});

test("tirar uma lâmina do meio reordena as que ficaram", async () => {
  const capa = novo("t1.png"), b = novo("t2.png"), c = novo("t3.png");
  await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [b, c] });
  const r = await pedir("DELETE", `/api/files/${b}/carrossel`);
  assert.equal(lerArquivo(b).carrossel_id, null);
  assert.deepEqual(r.corpo.laminas.map((l) => [l.id, l.carrossel_pos]), [[capa, 1], [c, 2]]);
});

test("apagar a capa não faz o post sumir: a próxima lâmina assume", async () => {
  const capa = novo("x1.png"), b = novo("x2.png"), c = novo("x3.png");
  await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [b, c] });
  await pedir("DELETE", `/api/files/${capa}`);
  assert.equal(lerArquivo(b).carrossel_id, b, "a segunda virou capa");
  assert.deepEqual(
    db.prepare("SELECT id FROM files WHERE carrossel_id = ? ORDER BY carrossel_pos").all(b).map((l) => l.id),
    [b, c]);
});

test("sobrando uma lâmina só, o carrossel deixa de existir", async () => {
  const capa = novo("u1.png"), b = novo("u2.png");
  await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [b] });
  await pedir("DELETE", `/api/files/${b}`);
  assert.equal(lerArquivo(capa).carrossel_id, null, "arte sozinha não é carrossel");
});

// --- os quadradinhos de seleção: apagar e mover em lote ----------------------

test("apagar os selecionados sai num pedido só", async () => {
  const a = novo("l1.png"), b = novo("l2.png"), c = novo("l3.png");
  const r = await pedir("POST", "/api/files/lote", { acao: "apagar", ids: [a, b, c] });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.apagados, 3);
  for (const id of [a, b, c]) assert.equal(lerArquivo(id), undefined);
});

test("mover a capa leva o post inteiro — carrossel não se parte entre pastas", async () => {
  const capa = novo("v1.png", pastaA), b = novo("v2.png", pastaA);
  await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [b] });
  const r = await pedir("POST", "/api/files/lote", { acao: "mover", ids: [capa], folder_id: pastaB });
  assert.equal(r.status, 200);
  assert.equal(lerArquivo(capa).folder_id, pastaB);
  assert.equal(lerArquivo(b).folder_id, pastaB, "a lâmina foi junto");
});

test("mover em lote para a raiz também funciona", async () => {
  const a = novo("r1.png", pastaA), b = novo("r2.png", pastaA);
  await pedir("POST", "/api/files/lote", { acao: "mover", ids: [a, b], folder_id: "" });
  assert.equal(lerArquivo(a).folder_id, null);
  assert.equal(lerArquivo(b).folder_id, null);
});

test("pasta de destino de outra casa é recusada", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Outra',0)").run().lastInsertRowid;
  const dela = db.prepare("INSERT INTO folders (name,org_id) VALUES ('Dela',?)").run(outra).lastInsertRowid;
  const a = novo("z1.png", pastaA);
  const r = await pedir("POST", "/api/files/lote", { acao: "mover", ids: [a], folder_id: dela });
  assert.equal(r.status, 400);
  assert.equal(lerArquivo(a).folder_id, pastaA);
});

test("arte de outra casa não entra no meu carrossel", async () => {
  const outra = db.prepare("SELECT id FROM organizations WHERE name = 'Outra'").get().id;
  const alheia = db.prepare(
    `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
     VALUES (NULL,'alheia.png','image/png',32,?,'editados',?)`).run(arte, outra).lastInsertRowid;
  const capa = novo("y1.png");
  const r = await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [alheia] });
  assert.equal(r.status, 400);
  assert.equal(lerArquivo(alheia).carrossel_id, null);
});

test("a listagem diz de que post cada arquivo é", async () => {
  const capa = novo("n1.png"), b = novo("n2.png");
  await pedir("POST", `/api/files/${capa}/carrossel`, { ids: [b] });
  const r = await pedir("GET", `/api/files?client_id=${cli}&folder_id=${pastaA}`);
  const achou = r.corpo.find((f) => f.id === b);
  assert.equal(achou.carrossel_id, capa);
  assert.equal(achou.carrossel_pos, 2);
});

// --- a conta que a tela faz com essa lista ----------------------------------

const aqui = dirname(fileURLToPath(import.meta.url));
const { agruparPosts, oQueArrastar } = await import("../../client/src/upload/unir-carrossel.js");
const tela = readFileSync(join(aqui, "../../client/src/pages/Files.jsx"), "utf8");

test("na grade, o post unido é UM cartão com as lâminas dentro", () => {
  const lista = [
    { id: 7, carrossel_id: 7, carrossel_pos: 1 },
    { id: 8, carrossel_id: 7, carrossel_pos: 2 },
    { id: 9, carrossel_id: 7, carrossel_pos: 3 },
    { id: 10, carrossel_id: null },
  ];
  const postos = agruparPosts(lista);
  assert.equal(postos.length, 2, "três lâminas viram um cartão só");
  assert.deepEqual(postos[0].laminas.map((l) => l.id), [7, 8, 9]);
  assert.equal(postos[1].laminas, null, "a arte solta continua solta");
});

test("a ordem das lâminas é a que foi montada, não a do banco", () => {
  const postos = agruparPosts([
    { id: 9, carrossel_id: 7, carrossel_pos: 3 },
    { id: 7, carrossel_id: 7, carrossel_pos: 1 },
    { id: 8, carrossel_id: 7, carrossel_pos: 2 },
  ]);
  assert.deepEqual(postos[0].laminas.map((l) => l.id), [7, 8, 9]);
});

test("post cuja capa não está nesta pasta ainda aparece", () => {
  const postos = agruparPosts([
    { id: 8, carrossel_id: 7, carrossel_pos: 2 },
    { id: 9, carrossel_id: 7, carrossel_pos: 3 },
  ]);
  assert.equal(postos.length, 1);
  assert.equal(postos[0].f.id, 8, "a primeira que sobrou faz as vezes de capa");
});

test("arrastar um cartão marcado leva a seleção inteira, na ordem", () => {
  assert.deepEqual(oQueArrastar(5, [3, 5, 9]), [3, 5, 9]);
  assert.deepEqual(oQueArrastar(4, [3, 5, 9]), [4], "não marcado vai sozinho");
});

// --- o que a tela promete -----------------------------------------------------

test("o cartão é alça de arrastar e alvo de solta", () => {
  assert.match(tela, /draggable/, "dá para pegar o cartão");
  assert.match(tela, /onUnir\(f, ids\)/, "soltar em cima une");
  assert.match(tela, /application\/x-perspecta-arte/,
    "o tipo é nosso, para não acionar a tela de envio de arquivos do computador");
});

test("baixar um post unido baixa as lâminas separadas, sem cortar nada", () => {
  const trecho = tela.slice(tela.indexOf("async function baixarLaminas"), tela.indexOf("const slides = ehGrupo"));
  assert.match(trecho, /for \(const l of laminas\)/);
  assert.match(trecho, /await onDownload\(l\)/, "uma de cada vez, na ordem");
  assert.ok(!/fatiarEmSlides/.test(trecho), "não passa por corte nenhum — não perde qualidade");
});

test("a tesoura só aparece na TIRA; o post unido já está separado", () => {
  assert.match(tela, /\{ehTira && \(\s*\n\s*<Tooltip title=\{cortando \? "Cortando…"/);
  assert.match(tela, /const ehTira = !ehGrupo && slides > 1/);
});

test("as opções saíram do menu de três pontinhos e viraram ícones", () => {
  assert.ok(!/MoreVertIcon/.test(tela), "o ⋮ sumiu");
  assert.ok(!/<Menu anchorEl/.test(tela), "e o menu junto");
  assert.match(tela, /<DriveFileMoveIcon sx=\{\{ fontSize: 17 \}\} \/>/, "mover virou ícone");
  assert.match(tela, /<LinkOffIcon sx=\{\{ fontSize: 17 \}\} \/>/, "separar virou ícone");
});

test("cada cartão tem o quadradinho de seleção no canto de cima", () => {
  const trecho = tela.slice(tela.indexOf("O QUADRADINHO DE SELEÇÃO"), tela.indexOf("Que é um carrossel"));
  assert.match(trecho, /<Checkbox/);
  assert.match(trecho, /top: 2, left: 2/, "no canto superior");
  assert.match(trecho, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/, "marcar não abre a arte");
});

test("a seleção serve para apagar, mover e unir", () => {
  assert.match(tela, /onClick=\{apagarSelecionados\}/);
  assert.match(tela, /setMoveTarget\(\{ ids: selecionados, folder_id: "" \}\)/);
  assert.match(tela, /onClick=\{unirSelecionados\}/);
});

test("apagar/mover vários sai num pedido só, não em vinte", () => {
  assert.match(tela, /api\.post\("\/files\/lote", \{ acao: "apagar", ids \}\)/);
  assert.match(tela, /api\.post\("\/files\/lote", \{ acao: "mover", ids: moveTarget\.ids/);
});

test("recarregar a tela não volta para o começo da Galeria", () => {
  // Pedido dela: "cada vez que eu dou command shift r, a tela volta pra
  // inicial da galeria; quero que quando recarregue, fique na mesma tela".
  assert.match(tela, /localStorage\.setItem\(ONDE_EU_ESTAVA/);
  assert.match(tela, /const \[clientId, setClientId\] = useState\(lugar\?\.clientId \|\| ""\)/);
  assert.match(tela, /const \[path, setPath\] = useState\(lugar\?\.path \|\| \[\]\)/);
  // E se o cliente guardado não existir mais, volta para a lista.
  assert.match(tela, /setClientId\(""\); setPath\(\[\]\);/);
});

// --- UNIR NA HORA, SEM ESPERAR O SERVIDOR ------------------------------------
//
// Pedido dela: "ainda demora quando arrasto um post pra cima do outro, demora
// pra sumir; consegue deixar instantâneo?".
//
// Demorava porque a tela esperava o pedido voltar e então recarregava a lista
// INTEIRA da pasta — que leva a miniatura de cada arquivo embutida. A união
// passa a ser aplicada na tela, na hora, com as MESMAS regras do servidor. Os
// testes abaixo comparam os dois lados: o que a tela mostra na hora tem de ser
// igual ao que o servidor grava.

const { aplicarUniao, aplicarSeparacao, aplicarRemocao } =
  await import("../../client/src/upload/unir-carrossel.js");

const comoNaTela = (linhas) => linhas.map((f) => [f.id, f.carrossel_id, f.carrossel_pos]);

test("a tela e o servidor chegam à mesma união", async () => {
  const a = novo("i1.png"), b2 = novo("i2.png"), c = novo("i3.png");
  const lista = [a, b2, c].map((id) => ({ id, carrossel_id: null, carrossel_pos: 0 }));

  const naTela = aplicarUniao(lista, a, [b2, c]);
  const r = await pedir("POST", `/api/files/${a}/carrossel`, { ids: [b2, c] });

  assert.deepEqual(comoNaTela(naTela), [[a, a, 1], [b2, a, 2], [c, a, 3]]);
  assert.deepEqual(r.corpo.laminas.map((l) => [l.id, l.carrossel_pos]), [[a, 1], [b2, 2], [c, 3]]);
});

test("na tela, soltar em cima de uma lâmina do meio também vale pelo post", () => {
  const lista = [
    { id: 1, carrossel_id: 1, carrossel_pos: 1 },
    { id: 2, carrossel_id: 1, carrossel_pos: 2 },
    { id: 3, carrossel_id: null, carrossel_pos: 0 },
  ];
  assert.deepEqual(comoNaTela(aplicarUniao(lista, 2, [3])),
    [[1, 1, 1], [2, 1, 2], [3, 1, 3]]);
});

test("na tela, arrastar um post inteiro leva as lâminas dele junto", () => {
  const lista = [
    { id: 1, carrossel_id: 1, carrossel_pos: 1 },
    { id: 2, carrossel_id: 1, carrossel_pos: 2 },
    { id: 8, carrossel_id: 8, carrossel_pos: 1 },
    { id: 9, carrossel_id: 8, carrossel_pos: 2 },
  ];
  assert.deepEqual(comoNaTela(aplicarUniao(lista, 1, [8])),
    [[1, 1, 1], [2, 1, 2], [8, 1, 3], [9, 1, 4]]);
});

test("na tela, soltar dentro do próprio post não mexe em nada", () => {
  const lista = [
    { id: 1, carrossel_id: 1, carrossel_pos: 1 },
    { id: 2, carrossel_id: 1, carrossel_pos: 2 },
  ];
  assert.deepEqual(aplicarUniao(lista, 1, [2]), lista, "a mesma lista, sem cópia nova");
});

test("na tela, a ordem é a em que foram arrastados", () => {
  const lista = [3, 1, 2].map((id) => ({ id, carrossel_id: null, carrossel_pos: 0 }));
  const r = aplicarUniao(lista, 3, [2, 1]);
  assert.deepEqual(r.find((f) => f.id === 2).carrossel_pos, 2);
  assert.deepEqual(r.find((f) => f.id === 1).carrossel_pos, 3);
});

test("separar e apagar também acontecem na hora", () => {
  const lista = [
    { id: 1, carrossel_id: 1, carrossel_pos: 1 },
    { id: 2, carrossel_id: 1, carrossel_pos: 2 },
    { id: 3, carrossel_id: 1, carrossel_pos: 3 },
  ];
  assert.deepEqual(comoNaTela(aplicarSeparacao(lista, 1)), [[1, null, 0], [2, null, 0], [3, null, 0]]);
  // Apagando uma, sobram duas: continua sendo post.
  assert.deepEqual(comoNaTela(aplicarRemocao(lista, [3])), [[1, 1, 1], [2, 1, 2]]);
  // Apagando duas, sobra uma: arte sozinha não é carrossel — igual ao servidor.
  assert.deepEqual(comoNaTela(aplicarRemocao(lista, [2, 3])), [[1, null, 0]]);
});

test("a tela não espera o pedido para a arte sumir da grade", () => {
  const trecho = tela.slice(tela.indexOf("async function unir(capa, ids)"), tela.indexOf("async function unirSelecionados"));
  // O setFiles vem ANTES do await: é isso que faz o cartão sumir na hora.
  assert.ok(trecho.indexOf("setFiles((atual) => aplicarUniao") < trecho.indexOf("await mexendo"),
    "a lista muda antes do pedido sair");
  assert.match(trecho, /catch \{ setFiles\(antes\); loadDocs\(true\); \}/, "e volta atrás se falhar");
  assert.ok(!/^\s*loadDocs\(true\);\s*$/m.test(trecho),
    "não recarrega a lista inteira no caminho feliz — era essa a demora");
});

test("aviso do canal ao vivo não recarrega a lista no meio de uma mexida", () => {
  assert.match(tela, /if \(emVoo\.current > 0 && !forcar\) return;/);
});

// --- rolar a página enquanto se arrasta --------------------------------------

const { velocidadeDaRolagem, FAIXA } = await import("../../client/src/upload/rolar-arrastando.js");

test("perto do rodapé a página desce sozinha, sem encostar na borda", () => {
  // No Mac, a borda de baixo é onde o Dock abre por cima — então a rolagem tem
  // de começar ANTES de chegar lá.
  const altura = 900;
  assert.ok(velocidadeDaRolagem(altura - FAIXA + 10, altura) > 0, "já dentro da faixa, desce");
  assert.ok(velocidadeDaRolagem(altura - 5, altura) > velocidadeDaRolagem(altura - FAIXA + 10, altura),
    "quanto mais fundo, mais rápido");
});

test("no meio da tela não rola, e perto do topo sobe", () => {
  assert.equal(velocidadeDaRolagem(450, 900), 0);
  assert.ok(velocidadeDaRolagem(10, 900) < 0);
});

test("as duas telas que têm arrasto ligam a rolagem", () => {
  assert.match(tela, /ligarRolagemAoArrastar\(\)/, "Galeria");
  const dist = readFileSync(join(aqui, "../../client/src/pages/Distribution.jsx"), "utf8");
  assert.match(dist, /ligarRolagemAoArrastar\(\)/, "Distribuição");
});

// --- O POST UNIDO CHEGA UNIDO NA DISTRIBUIÇÃO --------------------------------
//
// Pedido dela: "juntar os slides lá na galeria é justamente para, aqui na
// distribuição, quando eu clicar em 'da galeria', eles estarem agrupados. Tipo,
// 'Frases' tem vários slides; eu preciso poder selecionar todos de uma vez e
// virar carrossel aqui também."
//
// Antes as sete lâminas apareciam como sete itens soltos no seletor e tinham de
// ser escolhidas uma a uma. Agora o seletor usa o MESMO agrupamento da Galeria.

const dist = readFileSync(join(aqui, "../../client/src/pages/Distribution.jsx"), "utf8");

test("o seletor da Distribuição agrupa igual à Galeria", () => {
  const seletor = dist.slice(dist.indexOf("function GalleryPicker"), dist.indexOf("ESCOLHER A CAPA DO VÍDEO"));
  assert.match(seletor, /agruparPosts\(files\)/, "a mesma conta da Galeria");
  assert.ok(!/\{files\.map\(\(f\) =>/.test(seletor), "a lista solta, item por item, saiu");
  assert.match(seletor, /label=\{`\$\{laminas\.length\} lâminas`\}/, "e o item diz quantas lâminas leva");
});

test("escolher um post unido monta o carrossel inteiro, na ordem", () => {
  const trecho = dist.slice(dist.indexOf("async function pickFromGallery"), dist.indexOf("// TIRAR A ARTE"));
  assert.match(trecho, /laminas\?\.length > 1/);
  assert.match(trecho, /await saveSlides\(laminas\)/, "vira carrossel de uma vez");
  // saveSlides já faz a 1ª lâmina virar capa e arte da peça.
  assert.match(dist, /if \(next\[0\]\) \{ setCoverId\(next\[0\]\); setFileId\(next\[0\]\); \}/);
});

test("adicionar slide a partir de um post unido entra com todas as lâminas", () => {
  const trecho = dist.slice(dist.indexOf("async function addSlide"), dist.indexOf("const removeSlide"));
  assert.match(trecho, /laminas\?\.length > 1/);
  assert.match(trecho, /saveSlides\(\[\.\.\.slides, \.\.\.novas\]\)/);
  assert.match(trecho, /!slides\.includes\(l\)/, "sem repetir o que já está lá");
});

test("o post unido não passa pelo corte — as lâminas já são arquivos separados", () => {
  const trecho = dist.slice(dist.indexOf("async function addSlide"), dist.indexOf("const removeSlide"));
  const antesDoCorte = trecho.slice(0, trecho.indexOf("medirImagem"));
  assert.ok(antesDoCorte.includes("laminas?.length > 1"),
    "o caminho do post unido sai antes de qualquer medição/corte");
});

test("no seletor, a capa é sempre a PRIMEIRA lâmina, na forma de um post", () => {
  // Pedido dela: "tem como aqui já aparecer o primeiro slide como capa?".
  // Numa TIRA (carrossel salvo como uma imagem larga) o quadro vinha centrado:
  // aparecia uma lâmina do meio, espremida, e não dava para saber que post era.
  const seletor = dist.slice(dist.indexOf("function GalleryPicker"), dist.indexOf("ESCOLHER A CAPA DO VÍDEO"));
  assert.match(seletor, /<FeedThumb fileId=\{f\.id\} comecoDaTira/, "ancorado na primeira lâmina");
  assert.match(seletor, /aspectRatio: "4 \/ 5"/, "e com a forma de um post, como na Galeria");
  assert.ok(!/height: 110, bgcolor: "action\.hover"/.test(seletor), "o quadro baixinho e centrado saiu");
  // É `objectFit: cover` + âncora na esquerda que faz a primeira lâmina preencher.
  assert.match(dist, /objectPosition: comecoDaTira \? "left center" : "center"/);
});

test("o seletor usa a prévia, não a arte inteira", () => {
  const seletor = dist.slice(dist.indexOf("function GalleryPicker"), dist.indexOf("ESCOLHER A CAPA DO VÍDEO"));
  assert.match(seletor, /previaUrl=\{f\.preview_url \|\| null\}/);
  assert.match(seletor, /streamUrl=\{f\.media_url \|\| null\}/, "e o endereço direto, sem passar pelo servidor");
});
