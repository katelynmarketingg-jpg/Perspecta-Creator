// AUDITORIA DA TRAVA DE SENHA (Etapa 8 — segurança do caminho todo).
//
// O achado que gerou isto: medido no servidor rodando, a porta da agência e a
// do cliente aceitavam 60 senhas erradas em 5 segundos, sem nenhuma trava —
// ~11 palpites por segundo, quase um milhão por dia. A senha do cliente tem
// mínimo de 6 caracteres: cai numa lista de senhas comuns numa tarde.
//
// O que estes testes seguram: que a trava existe, que ela NÃO prende quem é de
// casa (acertar limpa a contagem), e que errar a senha de alguém não serve para
// trancar essa pessoa de propósito a partir de outro computador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-tranca-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { chaveDaPorta, faltaEsperar, registraErro, registraAcerto, _zera } =
  await import("../src/tranca.js");

const req = (ip) => ({ ip });

test("cinco erros ainda passam: quem é de casa erra a senha e tenta de novo", () => {
  _zera();
  const p = chaveDaPorta(req("1.1.1.1"), "agencia:Perspectiva:Katy");
  for (let i = 0; i < 5; i++) {
    registraErro(p);
    assert.equal(faltaEsperar(p), 0, `erro ${i + 1} não podia travar ainda`);
  }
});

test("a partir do sexto erro a porta manda esperar, e a espera cresce", () => {
  _zera();
  const p = chaveDaPorta(req("1.1.1.1"), "agencia:Perspectiva:Katy");
  for (let i = 0; i < 5; i++) registraErro(p);
  registraErro(p);
  const primeira = faltaEsperar(p);
  assert.ok(primeira > 0, "sexto erro tinha que travar");
  registraErro(p);
  assert.ok(faltaEsperar(p) > primeira, "a espera tem que crescer a cada erro");
});

test("a espera tem teto: nunca prende alguém para sempre", () => {
  _zera();
  const p = chaveDaPorta(req("1.1.1.1"), "agencia:Perspectiva:Katy");
  for (let i = 0; i < 200; i++) registraErro(p);
  assert.ok(faltaEsperar(p) <= 15 * 60_000, "no máximo 15 minutos");
});

test("acertar a senha limpa a contagem na hora", () => {
  _zera();
  const p = chaveDaPorta(req("1.1.1.1"), "agencia:Perspectiva:Katy");
  for (let i = 0; i < 10; i++) registraErro(p);
  assert.ok(faltaEsperar(p) > 0);
  registraAcerto(p);
  assert.equal(faltaEsperar(p), 0, "quem acertou a senha não pode ficar preso");
});

test("errar de um computador não tranca a pessoa nos outros", () => {
  _zera();
  const meu = chaveDaPorta(req("1.1.1.1"), "agencia:Perspectiva:Katy");
  const dela = chaveDaPorta(req("2.2.2.2"), "agencia:Perspectiva:Katy");
  for (let i = 0; i < 20; i++) registraErro(meu);
  assert.ok(faltaEsperar(meu) > 0);
  assert.equal(faltaEsperar(dela), 0, "não pode dar para trancar a conta de alguém de propósito");
});

test("a contagem some depois de meia hora sem erro", () => {
  _zera();
  const p = chaveDaPorta(req("1.1.1.1"), "agencia:Perspectiva:Katy");
  const agora = Date.now();
  for (let i = 0; i < 10; i++) registraErro(p, agora);
  assert.ok(faltaEsperar(p, agora) > 0);
  assert.equal(faltaEsperar(p, agora + 31 * 60_000), 0);
});

test("a porta da agência e a do cliente contam separado", () => {
  _zera();
  const agencia = chaveDaPorta(req("1.1.1.1"), "agencia:Perspectiva:Katy");
  const cliente = chaveDaPorta(req("1.1.1.1"), "portal:marcelo");
  for (let i = 0; i < 20; i++) registraErro(agencia);
  assert.equal(faltaEsperar(cliente), 0);
});
