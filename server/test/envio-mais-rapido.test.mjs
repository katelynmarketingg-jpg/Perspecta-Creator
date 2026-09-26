// "ESSE UPLOAD DAS FOTOS E VÍDEOS PODE SER MAIS RÁPIDO"
//
// Eram três vagas para todo mundo, e a miniatura era feita ANTES de abrir a
// conexão. Numa tela de catorze artes com dois vídeos no meio, isso quer dizer:
// o vídeo segura uma das três vagas por minutos, e cada arte pesada gasta
// segundos de CPU com a internet parada.
//
// Agora o leve e o pesado correm em raias separadas, e o pesado manda a
// miniatura depois de já estar guardado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const fonte = readFileSync(join(aqui, "../../client/src/upload/UploadContext.jsx"), "utf8");

test("leve e pesado têm filas separadas", () => {
  assert.match(fonte, /const leves = novos\.filter\(\(j\) => !ehPesado/);
  assert.match(fonte, /const pesados = novos\.filter\(\(j\) => ehPesado/);
  assert.match(fonte, /rodaFila\(leves, 4\)/, "arte pequena vai de quatro em quatro");
  assert.match(fonte, /rodaFila\(pesados, 1\)/, "pesado um de cada vez — dois juntos dividem a mesma banda");
});

test("não sobrou a vaga única de antes", () => {
  assert.ok(!/AO_MESMO_TEMPO/.test(fonte), "a fila única foi embora");
});

test("o total deixa uma conexão livre para o canal ao vivo", () => {
  // O navegador abre no máximo SEIS conexões por site. Ocupando as seis com
  // envio, o SSE fica sem vaga e a Galeria para de saber que chegou arquivo —
  // era preciso apertar F5.
  const leves = Number(fonte.match(/rodaFila\(leves, (\d+)\)/)[1]);
  const pesados = Number(fonte.match(/rodaFila\(pesados, (\d+)\)/)[1]);
  assert.ok(leves + pesados <= 5, `${leves} + ${pesados} não deixa vaga para o canal ao vivo`);
  assert.ok(leves > 3, "mas continua bem mais rápido que as três vagas de antes");
});

test("vídeo e arte grande contam como pesados", () => {
  assert.match(fonte, /const PESADO = 5 \* 1024 \* 1024/);
  assert.match(fonte, /ehPesado = \(file\) => ehVideo\(file\) \|\| \(file\?\.size \|\| 0\) > PESADO/);
});

test("a miniatura do pesado sai do caminho crítico do envio", () => {
  assert.match(fonte, /const thumb = ehPesado\(file\) \? null : await makeThumbnail\(file\)/,
    "só o leve gera a miniatura antes de abrir a conexão");
  assert.match(fonte, /if \(ehPesado\(job\._file\)\) mandaMiniaturaDepois/,
    "e o pesado manda a dele depois, com o arquivo já guardado");
});

test("a prévia continua indo para toda imagem, leve ou pesada", () => {
  assert.match(fonte, /if \(!ehVideo\(job\._file\)\) mandaPreviaDepois/,
    "vídeo não tem prévia; imagem tem, independentemente do tamanho");
});
