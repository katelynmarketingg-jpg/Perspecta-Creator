// O termo de veracidade é o comprovante anexado ao contrato assinado. Aqui a
// gente garante que ele junta as provas certas (hash, IP, e-mail verificado,
// dispositivo) e a base legal — e que não aparece quando nada foi assinado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { termoDeVeracidade, dispositivoLegivel } from "../../client/src/termo-de-veracidade.js";

test("sem assinatura, não há termo", () => {
  assert.equal(termoDeVeracidade({ id: 1, title: "X" }), "");
});

test("contrato assinado gera o termo com hash, trilha e base legal", () => {
  const html = termoDeVeracidade({
    id: 7, title: "Contrato de LP", signed_at: "2026-10-27 18:30:00",
    signer_name: "Fulano", signer_document: "12345678901",
    signer_ip: "200.1.2.3", signer_user_agent: "Mozilla/5.0 (iPhone) Safari/604",
    sign_verify_dest: "fu***@x.com", sign_verify_method: "email",
    signed_hash: "abc123def", signature_img: "data:image/png;base64,AAA",
  });
  assert.match(html, /Termo de Veracidade/);
  assert.match(html, /abc123def/, "o hash tem de aparecer");
  assert.match(html, /200\.1\.2\.3/, "o IP tem de aparecer");
  assert.match(html, /fu\*\*\*@x\.com/, "o e-mail verificado tem de aparecer");
  assert.match(html, /MP 2\.200-2/, "a base legal tem de aparecer");
  assert.match(html, /Lei 14\.063/);
  assert.match(html, /código único enviado por e-mail/i);
});

test("mostra o navegador e o sistema em linguagem de gente", () => {
  assert.equal(dispositivoLegivel("Mozilla/5.0 (iPhone; CPU iPhone OS) Safari/604"), "Safari em iPhone/iPad");
  assert.match(dispositivoLegivel("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537"), /Chrome em Windows/);
  assert.equal(dispositivoLegivel(""), "—");
});

test("texto alterado depois de assinar aparece no termo", () => {
  const html = termoDeVeracidade({
    id: 1, title: "X", signed_at: "2026-10-27 10:00:00", integridade: "alterado", signed_hash: "h",
  });
  assert.match(html, /alterado após a assinatura/i);
});
