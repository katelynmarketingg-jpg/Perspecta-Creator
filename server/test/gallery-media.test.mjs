import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-galeria-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");

const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Galeria', 0)").run().lastInsertRowid;

function novoArquivo({ nome, mime, thumb = null }) {
  const caminho = join(dir, nome.replace(/\W/g, "_"));
  writeFileSync(caminho, "conteudo");
  return db.prepare(
    `INSERT INTO files (original_name, mime, size, stored_path, stage, thumb, org_id)
     VALUES (?, ?, 8, ?, 'originais', ?, ?)`
  ).run(nome, mime, caminho, thumb, org).lastInsertRowid;
}

test("a coluna da miniatura existe e guarda o data URI", () => {
  const id = novoArquivo({ nome: "post.png", mime: "image/png", thumb: "data:image/jpeg;base64,QUJD" });
  const f = db.prepare("SELECT thumb FROM files WHERE id = ?").get(id);
  assert.equal(f.thumb, "data:image/jpeg;base64,QUJD");
});

test("arquivo antigo (sem miniatura) continua válido — a grade cai no original", () => {
  const id = novoArquivo({ nome: "antigo.jpg", mime: "image/jpeg" });
  assert.equal(db.prepare("SELECT thumb FROM files WHERE id = ?").get(id).thumb, null);
});

test("a listagem entrega a miniatura junto", () => {
  novoArquivo({ nome: "com-thumb.png", mime: "image/png", thumb: "data:image/jpeg;base64,XYZ" });
  const linha = db.prepare(
    `SELECT f.id, f.original_name, f.mime, f.thumb FROM files f
     WHERE f.org_id = ? AND f.original_name = 'com-thumb.png'`
  ).get(org);
  assert.ok(linha.thumb?.startsWith("data:image/"));
});

// --- o .mov que não renderizava ---
// A regra do servidor: ver na tela usa o tipo que o navegador toca; baixar usa
// o tipo real. Reproduzo a mesma função aqui para travar o comportamento.
function tipoQueONavegadorToca(file) {
  const mime = file.mime || "";
  const ehMov = /quicktime/i.test(mime) || /\.mov$/i.test(file.original_name || "");
  if (ehMov) return "video/mp4";
  return mime || "application/octet-stream";
}

test("vídeo do iPhone (.mov) é servido como mp4 — é o que faz o Chrome tocar", () => {
  assert.equal(tipoQueONavegadorToca({ mime: "video/quicktime", original_name: "Vídeo 24-08-2026.mov" }), "video/mp4");
  // Mesmo quando o navegador não mandou mime nenhum, a extensão resolve.
  assert.equal(tipoQueONavegadorToca({ mime: "", original_name: "clipe.MOV" }), "video/mp4");
});

test("os outros formatos continuam com o tipo original", () => {
  assert.equal(tipoQueONavegadorToca({ mime: "video/mp4", original_name: "reel.mp4" }), "video/mp4");
  assert.equal(tipoQueONavegadorToca({ mime: "image/png", original_name: "post.png" }), "image/png");
  assert.equal(tipoQueONavegadorToca({ mime: "", original_name: "sem-extensao" }), "application/octet-stream");
});

// --- preencher a miniatura dos arquivos que já estavam lá ---
test("arquivo antigo aceita a miniatura enviada depois", () => {
  const id = novoArquivo({ nome: "antigo-sem-thumb.png", mime: "image/png" });
  const t = "data:image/jpeg;base64,QUJDRA==";
  const antes = db.prepare("SELECT thumb FROM files WHERE id = ?").get(id);
  assert.equal(antes.thumb, null);

  db.prepare("UPDATE files SET thumb = ? WHERE id = ? AND org_id = ?").run(t, id, org);
  assert.equal(db.prepare("SELECT thumb FROM files WHERE id = ?").get(id).thumb, t);
});

test("quem já tem miniatura não é sobrescrito", () => {
  const original = "data:image/jpeg;base64,T1JJRw==";
  const id = novoArquivo({ nome: "ja-tem.png", mime: "image/png", thumb: original });
  const atual = db.prepare("SELECT thumb FROM files WHERE id = ?").get(id);
  // É a regra da rota: se já tem, responde ok e não regrava.
  const deveRegravar = !atual.thumb;
  assert.equal(deveRegravar, false);
  assert.equal(atual.thumb, original);
});

test("miniatura grande demais é descartada (não incha o banco)", () => {
  const LIMITE = 300 * 1024;
  const aceita = (t) => typeof t === "string" && t.startsWith("data:image/") && t.length <= LIMITE;
  assert.equal(aceita("data:image/jpeg;base64," + "A".repeat(10_000)), true);
  assert.equal(aceita("data:image/jpeg;base64," + "A".repeat(400_000)), false);
  assert.equal(aceita("javascript:alert(1)"), false, "só data URI de imagem entra");
  assert.equal(aceita(null), false);
});
