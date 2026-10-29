// DUAS COISAS DA TELA DE ASSINATURA.
//
// 1) "ficou quebrada a questão da página, pode separar por páginas, 1, 2, 3,
//    conforme cabe nas folhas a4". O contrato aparecia numa folha só dentro de
//    uma caixa de rolagem — e, por ser item de um flex com altura fixa, a
//    folha branca parava no meio enquanto o texto continuava por fora dela.
//    Quem ia assinar via um documento rachado.
//
// 2) "e-mail de verificação não vai". O envio falhava e a tela dizia só "não
//    foi possível enviar": o motivo do provedor morria num catch, sem log e
//    sem aviso. Sem o motivo (quase sempre o remetente num domínio não
//    verificado), não havia como consertar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ler = (p) => readFileSync(join(RAIZ, p), "utf8");
const folhas = ler("client/src/components/FolhasDoContrato.jsx");
const assinar = ler("client/src/pages/SignContract.jsx");
const signjs = ler("server/src/routes/sign.js");

test("a folha é A4 de verdade, com as margens do contrato", () => {
  assert.match(folhas, /const A4_L = Math\.round\(21 \* PX_POR_CM\)/);
  assert.match(folhas, /const A4_A = Math\.round\(29\.7 \* PX_POR_CM\)/);
  assert.match(folhas, /paginaDoContrato\(pagina\)/,
    "a margem e a entrelinha são as do próprio contrato — as mesmas que vão para a impressora");
});

test("o texto é medido e distribuído; bloco não se parte ao meio", () => {
  assert.match(folhas, /if \(altura > 0 && altura \+ h > alturaUtil\) \{ folhas\.push\(\[\]\); altura = 0; \}/,
    "é a conta que decide a quebra: o que não cabe começa na folha seguinte");
  assert.match(folhas, /visibility: "hidden"/, "o medidor não pode aparecer");
});

test("cada folha diz o número dela", () => {
  assert.match(folhas, /\{i \+ 1\} de \{folhas\.length\}/);
});

test("a tela de assinatura usa as folhas, e não a caixa que rachava", () => {
  assert.match(assinar, /<FolhasDoContrato texto=\{contract\?\.notes\}/);
  assert.ok(!/maxHeight: "60vh", overflowY: "auto"/.test(assinar),
    "era a caixa de altura fixa que cortava a folha branca no meio");
});

test("o servidor manda a página do contrato — sem o logo junto", () => {
  assert.match(signjs, /pagina,/);
  assert.match(signjs, /JSON\.parse\(c\.style \|\| "\{\}"\)\?\.pagina/);
  assert.ok(!/style: c\.style/.test(signjs),
    "o estilo inteiro carrega o logo em data URI: megabytes que ninguém vê nesta tela");
});

// ---- o e-mail que não saía -------------------------------------------------

test("o motivo do provedor é traduzido, não engolido", async () => {
  const { motivoDoErro } = await import("../src/email.js");
  assert.match(motivoDoErro({ response: "550 5.7.1 The domain is not verified" }),
    /remetente \(MAIL_FROM\)/, "é a causa mais comum, e a tela tem de dizer isso");
  assert.match(motivoDoErro({ code: "EAUTH", message: "Invalid login" }), /recusados/);
  assert.match(motivoDoErro({ code: "ECONNECTION", message: "connect ETIMEDOUT" }), /host\/porta/);
  assert.equal(motivoDoErro({ message: "algo estranho" }), "algo estranho");
});

test("a configuração aparece sem a senha, e diz o que falta", async () => {
  const { configuracaoDoEmail } = await import("../src/email.js");
  const c = configuracaoDoEmail();
  assert.ok(!("senha" in c) && !("pass" in c), "senha não sai daqui nem por engano");
  assert.ok(Array.isArray(c.faltando));
});

test("quando o código não sai, a agência é avisada com o motivo", () => {
  assert.match(signjs, /console\.error\("\[email\] o código de assinatura não saiu:", motivo\)/);
  assert.match(signjs, /O código para assinar "\$\{c\.title\}" não foi enviado: \$\{motivo\}/);
  // Para o cliente, nada de detalhe de servidor — só o caminho a seguir.
  assert.match(signjs, /A sua agência já foi avisada — fale com ela/);
});

test("ela consegue testar o envio sozinha, e ver a resposta do provedor", () => {
  const integra = ler("server/src/routes/integrations.js");
  assert.match(integra, /router\.post\("\/email\/teste"/);
  assert.match(integra, /res\.status\(502\)\.json\(\{ error: motivo/);
  const config = ler("client/src/pages/Settings.jsx");
  assert.match(config, /E-mail dos códigos de assinatura/);
  assert.match(config, /integrations\/email\/teste/);
});
