import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "pc-meta-")), "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const {
  savePendingPages, getPendingPages, clearPendingPages, publicPage,
  saveConnection, getConnection,
} = await import("../src/meta.js");

const orgA = db.prepare("INSERT INTO organizations (name, is_master) VALUES (?, 0)").run("Agência A").lastInsertRowid;
const orgB = db.prepare("INSERT INTO organizations (name, is_master) VALUES (?, 0)").run("Agência B").lastInsertRowid;
const cli = (org, nome) => db.prepare("INSERT INTO clients (name, status, org_id) VALUES (?, 'active', ?)").run(nome, org).lastInsertRowid;
const clienteA = cli(orgA, "Aliança");
const clienteB = cli(orgA, "Dra. Camila");
const doOutro = cli(orgB, "De outro escritório");

// O que a Meta devolveria para quem administra três páginas.
const PAGINAS = [
  { page_id: "111", page_name: "Aliança Materiais", page_token: "tok-alianca", ig_user_id: "ig1", ig_username: "aliancamateriais", expires_in: 5184000 },
  { page_id: "222", page_name: "Dra. Camila Braga", page_token: "tok-camila", ig_user_id: "ig2", ig_username: "dracamilabraga", expires_in: 5184000 },
  { page_id: "333", page_name: "Página antiga sem IG", page_token: "tok-antiga", ig_user_id: null, ig_username: null, expires_in: 5184000 },
];

test("as páginas ficam guardadas até alguém escolher", () => {
  savePendingPages(orgA, clienteA, PAGINAS);
  const guardadas = getPendingPages(orgA, clienteA);
  assert.equal(guardadas.length, 3);
  assert.equal(guardadas[1].page_name, "Dra. Camila Braga");
});

test("a lista que vai para a tela NÃO leva o token da página", () => {
  const paraTela = getPendingPages(orgA, clienteA).map(publicPage);
  const texto = JSON.stringify(paraTela);
  assert.ok(!texto.includes("tok-"), "nenhum token pode vazar para o navegador");
  assert.equal(paraTela[0].has_instagram, true);
  assert.equal(paraTela[2].has_instagram, false, "página sem IG fica marcada");
});

test("as candidatas ficam cifradas no banco", () => {
  const bruto = db.prepare("SELECT pages FROM meta_pending WHERE client_id = ?").get(clienteA).pages;
  assert.ok(!bruto.includes("tok-alianca"), "o token não pode estar legível no banco");
});

test("escolher a segunda página conecta ELA, não a primeira", () => {
  const escolhida = getPendingPages(orgA, clienteA).find((p) => p.page_id === "222");
  saveConnection(orgA, clienteA, escolhida);
  clearPendingPages(orgA, clienteA);

  const conn = getConnection(clienteA, orgA);
  assert.equal(conn.page_id, "222");
  assert.equal(conn.ig_username, "dracamilabraga");
  assert.equal(conn.access_token, "tok-camila", "o token é o da página escolhida");
  assert.equal(getPendingPages(orgA, clienteA), null, "a pendência some depois da escolha");
});

test("um escritório não enxerga a escolha pendente do outro", () => {
  savePendingPages(orgA, clienteB, PAGINAS);
  assert.equal(getPendingPages(orgB, clienteB), null);
  assert.ok(getPendingPages(orgA, clienteB));
  const pendentesDeB = db.prepare("SELECT client_id FROM meta_pending WHERE org_id = ?").all(orgB);
  assert.equal(pendentesDeB.length, 0);
});

test("cada cliente guarda a sua escolha, sem se misturar", () => {
  const camila = getPendingPages(orgA, clienteB).find((p) => p.page_id === "111");
  saveConnection(orgA, clienteB, camila);
  assert.equal(getConnection(clienteA, orgA).page_id, "222");
  assert.equal(getConnection(clienteB, orgA).page_id, "111");
});

test("conectar de novo troca a página, sem duplicar", () => {
  const outra = PAGINAS.find((p) => p.page_id === "333");
  saveConnection(orgA, clienteB, outra);
  const n = db.prepare("SELECT COUNT(*) AS n FROM integrations WHERE client_id = ? AND provider='meta'").get(clienteB).n;
  assert.equal(n, 1, "uma linha por cliente");
  assert.equal(getConnection(clienteB, orgA).page_id, "333");
});
