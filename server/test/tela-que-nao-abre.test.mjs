// A TELA QUE NÃO ABRE DEPOIS DE UMA PUBLICAÇÃO.
//
// "creator não tá abrindo a galeria na versão mobile."
//
// Cada tela é um arquivo com o nome carimbado pelo conteúdo
// (Files-Bkd8x6pt.js). A cada publicação os nomes mudam e os antigos somem do
// servidor. Quem está com o aplicativo ABERTO desde antes — e no celular ele
// fica aberto dias — continua rodando a versão velha; ao tocar numa tela que
// ainda não tinha aberto, vai buscar um arquivo que não existe mais.
//
// Reproduzido no Chromium, em tela de iPhone: TELA EM BRANCO, com
// "Failed to fetch dynamically imported module". Nenhum aviso, nada.
//
// Por isso batia só no celular (o desktop ela recarrega o tempo todo) e só em
// algumas telas (as que ela abre com menos frequência).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "../..");
const app = readFileSync(join(RAIZ, "client/src/App.jsx"), "utf8");

test("nenhuma tela é carregada sem a rede de proteção", () => {
  // lazy() cru é o que deixava a tela em branco.
  assert.ok(!/= lazy\(\(\) => import\(/.test(app),
    "ainda há tela com lazy() direto — essa fica em branco quando o arquivo some");
  assert.ok(app.split("telaAdiada(() => import(").length - 1 >= 25,
    "as telas adiadas passam todas por telaAdiada");
});

test("arquivo que sumiu: recarrega UMA vez e pronto", () => {
  const f = app.slice(app.indexOf("function telaAdiada"), app.indexOf("// O painel puxa"));
  assert.match(f, /window\.location\.reload\(\)/);
  assert.match(f, /if \(lembrete\.ja\(\)\) throw erro/, "a guarda é o que impede laço de recarga");
  assert.match(f, /lembrete\.limpa\(\)/, "abriu: a marca sai, senão a próxima falha não recarrega");
  assert.match(f, /return new Promise\(\(\) => \{\}\)/,
    "segura até a página trocar — senão a tela em branco pisca antes");
});

test("a marca de recarga sobrevive a navegador anônimo", () => {
  const f = app.slice(app.indexOf("const lembrete"), app.indexOf("function telaAdiada"));
  assert.equal((f.match(/try \{/g) || []).length, 3, "sessionStorage lança em algumas situações");
});

test("se mesmo assim falhar, aparece recado — nunca um retângulo branco", () => {
  assert.match(app, /class TelaQueFalhou extends Component/);
  assert.match(app, /getDerivedStateFromError/);
  assert.match(app, /Não deu para abrir esta tela/);
  assert.match(app, /Recarregar/);
  // e ela embrulha as rotas de verdade
  const i = app.indexOf("<TelaQueFalhou>");
  assert.ok(i > 0 && i < app.indexOf("<Suspense"), "tem de ficar POR FORA do Suspense");
});

test("o servidor devolve 404 para pacote que não existe, não a página", () => {
  // Respondendo index.html, o navegador recebe HTML onde esperava programa e
  // reclama de "MIME type" — erro que não ajuda ninguém a entender.
  const idx = readFileSync(join(RAIZ, "server/src/index.js"), "utf8");
  const i = idx.indexOf('app.get(/^\\/assets\\//');
  const curinga = idx.indexOf('app.get("*"');
  assert.ok(i > 0, "falta a regra dos /assets/");
  assert.ok(i < curinga, "tem de vir ANTES do curinga, senão o curinga pega primeiro");
});
