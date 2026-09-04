import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PassThrough } from "node:stream";

// Reproduz o que acontecia: o R2 devolve um stream, o envio começa e algo
// quebra no meio (a conexão cai, ou o navegador cancela a imagem).
function streamQueQuebraNoMeio() {
  const s = new Readable({ read() {} });
  s.push(Buffer.from("inicio do arquivo"));
  setImmediate(() => s.destroy(new Error("conexão com o R2 caiu")));
  return s;
}

test("ANTES: .pipe(res) deixa o erro solto — é o que derrubava o servidor", async () => {
  const origem = streamQueQuebraNoMeio();
  const destino = new PassThrough();
  origem.pipe(destino);

  // Sem ninguém ouvindo 'error', o Node trata como exceção não capturada.
  const solto = await new Promise((resolve) => {
    origem.on("error", (e) => resolve(e));       // só para o teste não estourar
    setTimeout(() => resolve(null), 50);
  });
  assert.ok(solto, "o stream emite 'error' — sem tratar, o processo cai");
});

test("DEPOIS: pipeline entrega o erro para o nosso código, e o processo segue", async () => {
  const origem = streamQueQuebraNoMeio();
  const destino = new PassThrough();

  let capturado = null;
  await pipeline(origem, destino).catch((e) => { capturado = e; });

  assert.ok(capturado, "o erro chega ao catch em vez de virar exceção solta");
  assert.match(capturado.message, /R2/);
  assert.equal(destino.destroyed, true, "o pipeline fecha os dois lados");
});

test("DEPOIS: navegador cancelando o download não vira erro barulhento", async () => {
  const origem = new Readable({ read() {} });
  origem.push(Buffer.from("um pedaço"));
  const destino = new PassThrough();
  setImmediate(() => destino.destroy());          // é o que o navegador faz

  let erro = null;
  await pipeline(origem, destino).catch((e) => { erro = e; });
  assert.equal(erro?.code, "ERR_STREAM_PREMATURE_CLOSE",
    "cancelamento tem código próprio — o código não polui o log com isso");
});

test("a rede de segurança do servidor registra em vez de deixar cair", () => {
  const antes = process.listenerCount("unhandledRejection");
  process.on("unhandledRejection", () => {});
  assert.ok(process.listenerCount("unhandledRejection") > antes,
    "com um ouvinte registrado, a promessa rejeitada não encerra o processo");
  process.removeAllListeners("unhandledRejection");
});
