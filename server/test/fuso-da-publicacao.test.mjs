// A HORA MARCADA É A HORA DAQUI.
//
// Pergunta dela: "eu tinha aprovado um post da Von para que entrasse hoje às
// 15:25, para poder testar a integração. Não funcionou, por quê?"
//
// O servidor roda com o relógio de Greenwich. A hora que o navegador grava é a
// hora do Brasil, sem fuso junto: "2026-10-05 15:25", texto puro. O robô
// comparava uma com a outra — então, para ele, as 15:25 chegavam às 12:25
// daqui. Três horas antes.
//
// Dois efeitos, os dois ruins: o post podia ir ao ar cedo demais, e a conta do
// atraso saía errada. Agora a comparação é feita no fuso da agência.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-fuso-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { agoraNaAgencia, FUSO } = await import("../src/fuso.js");
const { avisarAtrasados, runAutoPublish, prontosParaPublicar } = await import("../src/publisher.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Fuso',0)").run().lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,auto_publish,org_id) VALUES ('Von Saltiel','active',1,?)")
  .run(org).lastInsertRowid;
db.prepare("INSERT INTO integrations (client_id,provider,org_id) VALUES (?,'meta',?)").run(cli, org);

const arte = () => db.prepare(
  `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
   VALUES (?,'a.png','image/png',10,'x','editados',?)`).run(cli, org).lastInsertRowid;

function peca({ quando, titulo, comArte = true }) {
  const id = db.prepare(
    `INSERT INTO tasks (title,client_id,scheduled_at,approval_status,org_id)
     VALUES (?,?,?,'approved',?)`).run(titulo, cli, quando, org).lastInsertRowid;
  if (comArte) db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(id, arte());
  return id;
}
const avisosDe = (id) => db.prepare("SELECT message FROM notifications WHERE task_id = ?").all(id);

/** Uma hora marcada daqui a N horas, no relógio DAQUI. */
const daquiA = (h) => {
  const base = new Date(`${agoraNaAgencia().replace(" ", "T")}Z`);
  base.setUTCHours(base.getUTCHours() + h);
  return base.toISOString().slice(0, 19).replace("T", " ");
};

after(() => db.close());

test("agoraNaAgencia fala no formato do banco", () => {
  assert.match(agoraNaAgencia(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(FUSO, "America/Sao_Paulo");
});

test("é um relógio diferente do do servidor — e essa diferença era o bug", () => {
  const servidor = db.prepare("SELECT datetime('now') AS t").get().t;
  const daqui = agoraNaAgencia();
  const diferenca = (new Date(`${servidor}Z`) - new Date(`${daqui.replace(" ", "T")}Z`)) / 3600000;
  assert.ok(diferenca >= 2 && diferenca <= 5,
    `o servidor está ${diferenca}h à frente — era por isso que as 15:25 chegavam antes`);
});

test("o post das 15:25 não entra na fila ao meio-dia", () => {
  // É ISTO que o bug fazia. Marcado para daqui a uma hora, no relógio dela:
  // pela conta velha (a de Greenwich) o servidor já achava que a hora tinha
  // passado há duas, e mandava o post ao ar cedo.
  const id = peca({ quando: daquiA(1), titulo: "Daqui a uma hora" });
  const fila = prontosParaPublicar().map((t) => t.id);
  assert.ok(!fila.includes(id), "ainda não é hora: o robô não pode pegar");
});

test("chegada a hora, aí sim entra na fila", () => {
  const id = peca({ quando: daquiA(-1), titulo: "Faz uma hora, era para ter saído" });
  const fila = prontosParaPublicar().map((t) => t.id);
  assert.ok(fila.includes(id), "passou da hora daqui: agora vai");
});

test("passada a hora de verdade, aí sim cobra", () => {
  const id = peca({ quando: daquiA(-1), titulo: "Faz uma hora" });
  // auto_publish está ligado e a peça está na janela: quem vai pegá-la é o
  // robô, então ainda não é atraso — é fila.
  avisarAtrasados(org);
  assert.deepEqual(avisosDe(id), []);

  // Fora da janela de 48h, aí é atraso de verdade.
  const velha = peca({ quando: daquiA(-72), titulo: "De anteontem" });
  avisarAtrasados(org);
  assert.equal(avisosDe(velha).length, 1);
  assert.match(avisosDe(velha)[0].message, /48h/);
});

test("o aviso diz POR QUE não saiu: sem arte", () => {
  const id = peca({ quando: daquiA(-72), titulo: "Sem arte nenhuma", comArte: false });
  avisarAtrasados(org);
  assert.match(avisosDe(id)[0].message, /Falta a arte/);
});

test("o aviso diz POR QUE não saiu: automático desligado", () => {
  db.prepare("UPDATE clients SET auto_publish = 0 WHERE id = ?").run(cli);
  const id = peca({ quando: daquiA(-2), titulo: "Com o automático desligado" });
  avisarAtrasados(org);
  assert.match(avisosDe(id)[0].message, /desligada neste cliente/);
  db.prepare("UPDATE clients SET auto_publish = 1 WHERE id = ?").run(cli);
});

test("o aviso diz POR QUE não saiu: já estava programado quando ligaram", () => {
  db.prepare("UPDATE clients SET auto_publish_desde = ? WHERE id = ?").run(daquiA(-1), cli);
  const id = peca({ quando: daquiA(-3), titulo: "De antes do interruptor" });
  avisarAtrasados(org);
  assert.match(avisosDe(id)[0].message, /quando o automático foi ligado/);
  db.prepare("UPDATE clients SET auto_publish_desde = NULL WHERE id = ?").run(cli);
});

test("sem a Meta configurada, o atraso AINDA avisa", async () => {
  // Era o silêncio mais perigoso: sem as chaves da Meta, a rotina voltava
  // calada — nada publicava e ninguém ficava sabendo.
  const id = peca({ quando: daquiA(-72), titulo: "Sem a Meta configurada" });
  const r = await runAutoPublish();
  assert.equal(r.motivo, "Meta não configurada");
  assert.ok(r.atrasados >= 1, "voltou contando os atrasados");
  assert.equal(avisosDe(id).length, 1);
});

test("a marca de 'automático ligado desde' nasce no fuso daqui", async () => {
  const { default: nada } = await import("../src/routes/integrations.js");
  assert.ok(nada, "a rota existe");
  const fonte = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/routes/integrations.js", import.meta.url), "utf8"));
  assert.match(fonte, /auto_publish \? agoraNaAgencia\(\)/,
    "gravar em Greenwich aqui recriaria o mesmo descompasso de três horas");
});
