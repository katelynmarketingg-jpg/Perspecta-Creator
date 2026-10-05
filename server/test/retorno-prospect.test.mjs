// "RETORNAR EM": a data de voltar a falar com quem está na Prospecção.
//
// Pedido dela: "ele tem primeiro contato, mas nem está mais no primeiro
// contato. Quero poder colocar ali dentro uma tarefa de chamar novamente e
// botar a data. E daí essa data vai aparecer para mim nas Prioridades... quero
// que venha a notificação para mim e que também interligue isso a prioridades."
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-retorno-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { lembrarRetornos, marcarRetorno, prioridadeDoRetorno } = await import("../src/retorno-prospect.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const prospects = (await import("../src/routes/prospects.js")).default;
const priorities = (await import("../src/routes/priorities.js")).default;
const notifications = (await import("../src/routes/notifications.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Retorno',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@r.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const rafa = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Rafa','R','r@r.com',?,'user',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/prospects", prospects);
app.use("/api/priorities", priorities);
app.use("/api/notifications", notifications);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const pedir = async (metodo, caminho, corpo) => {
  const r = await fetch(`${B}${caminho}`, {
    method: metodo, headers: H, body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

const novoProspect = (nome = "Mérian", empresa = "Kielbovicz") =>
  db.prepare("INSERT INTO prospects (org_id,name,company,status) VALUES (?,?,?,'proposta')")
    .run(org, nome, empresa).lastInsertRowid;

const dias = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const hoje = () => new Date().toISOString().slice(0, 10);
const lerProspect = (id) => db.prepare("SELECT * FROM prospects WHERE id = ?").get(id);
const avisos = () => db.prepare("SELECT * FROM notifications WHERE org_id = ? ORDER BY id").all(org);

// --- marcar o retorno ---------------------------------------------------------

test("marcar a data cria a prioridade ligada ao prospect", async () => {
  const p = novoProspect();
  const r = await pedir("PUT", `/prospects/${p}/retorno`, {
    data: dias(3), nota: "Perguntar se viu a proposta", level: "alta", assignee_id: rafa,
  });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.retorno_em, dias(3));
  assert.equal(r.corpo.retorno_nota, "Perguntar se viu a proposta");

  const pr = prioridadeDoRetorno(org, p);
  assert.ok(pr, "nasceu a prioridade");
  assert.equal(pr.due_date, dias(3));
  assert.equal(pr.level, "alta");
  assert.equal(pr.assignee_id, rafa);
  assert.equal(pr.prospect_id, p);
  assert.match(pr.message, /Mérian/);
  assert.match(pr.message, /Perguntar se viu a proposta/);
});

test("remarcar MUDA o recado que existe — não empilha outro", async () => {
  const p = novoProspect("Gabriela", "Clínica Afeto");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(2) });
  const primeira = prioridadeDoRetorno(org, p);

  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(9), nota: "Ela pediu para ligar depois do dia 20" });
  const agora = prioridadeDoRetorno(org, p);

  assert.equal(agora.id, primeira.id, "é o mesmo recado");
  assert.equal(agora.due_date, dias(9));
  assert.match(agora.message, /depois do dia 20/);
  const quantas = db.prepare("SELECT COUNT(*) n FROM priorities WHERE prospect_id = ?").get(p).n;
  assert.equal(quantas, 1, "um prospect, um retorno aberto");
});

test("tirar a data some com a prioridade aberta", async () => {
  const p = novoProspect("Franciele");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(1) });
  const r = await pedir("DELETE", `/prospects/${p}/retorno`);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.retorno_em, null);
  assert.equal(prioridadeDoRetorno(org, p), undefined);
});

test("prospect de outra casa não é tocado", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const alheio = db.prepare("INSERT INTO prospects (org_id,name,status) VALUES (?,'Dela','novo')").run(outra).lastInsertRowid;
  const r = await pedir("PUT", `/prospects/${alheio}/retorno`, { data: dias(1) });
  assert.equal(r.status, 404);
  assert.equal(lerProspect(alheio).retorno_em, null);
});

// --- o quadro de Prioridades --------------------------------------------------

test("a prioridade do retorno aparece na listagem, com data e de quem é", async () => {
  const p = novoProspect("Diego", "Seguros Meregali");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(5), nota: "2ª tentativa" });
  const r = await pedir("GET", "/priorities");
  const achou = r.corpo.find((x) => x.prospect_id === p);
  assert.ok(achou, "está no quadro");
  assert.equal(achou.due_date, dias(5));
  assert.equal(achou.prospect_name, "Diego");
});

test("o que tem data vem antes do que não tem, e o mais cedo primeiro", async () => {
  // Uma prioridade solta, sem data — dessas que já existiam antes desta função.
  await pedir("POST", "/priorities", { message: "Recado sem prazo", level: "alta" });
  const tarde = novoProspect("Tarde");
  const cedo = novoProspect("Cedo");
  await pedir("PUT", `/prospects/${tarde}/retorno`, { data: dias(30) });
  await pedir("PUT", `/prospects/${cedo}/retorno`, { data: dias(1) });

  const lista = (await pedir("GET", "/priorities")).corpo;
  const comData = lista.filter((x) => x.due_date).map((x) => x.due_date);
  assert.deepEqual([...comData].sort(), comData, "as datas sobem");
  const primeiraSemData = lista.findIndex((x) => !x.due_date);
  const ultimaComData = lista.map((x) => Boolean(x.due_date)).lastIndexOf(true);
  assert.ok(primeiraSemData > ultimaComData, "sem prazo fica no fim");
});

test("concluir o recado tira a data do cartão da Prospecção", async () => {
  const p = novoProspect("Concluído");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(2) });
  const pr = prioridadeDoRetorno(org, p);

  await pedir("PUT", `/priorities/${pr.id}/status`, { status: "done" });

  assert.equal(lerProspect(p).retorno_em, null, "o cartão não promete mais um retorno já resolvido");
  assert.equal(prioridadeDoRetorno(org, p), undefined);
  assert.ok(db.prepare("SELECT 1 FROM priorities WHERE id = ?").get(pr.id), "o recado concluído fica no histórico");
});

test("arquivar o recado NÃO apaga a data", async () => {
  // Era "em andamento", coluna que saiu do quadro a pedido dela. Só CONCLUIR
  // tira o retorno do cartão da Prospecção — arquivar é só sair da frente.
  const p = novoProspect("Andando");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(4) });
  const pr = prioridadeDoRetorno(org, p);
  const r = await pedir("PUT", `/priorities/${pr.id}/status`, { status: "arquivado" });
  assert.equal(r.status, 200);
  assert.equal(lerProspect(p).retorno_em, dias(4));
});

test("'em andamento' não existe mais", async () => {
  const p = novoProspect("SemAndamento");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(4) });
  const pr = prioridadeDoRetorno(org, p);
  const r = await pedir("PUT", `/priorities/${pr.id}/status`, { status: "doing" });
  assert.equal(r.status, 400, "a coluna saiu do quadro");
});

// --- o aviso ------------------------------------------------------------------

test("no dia, o aviso sai — e não repete no mesmo dia", async () => {
  const p = novoProspect("Hoje");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: hoje(), nota: "ligar de manhã" });

  const antes = avisos().length;
  lembrarRetornos(org);
  // Outros prospects deste arquivo também têm data por perto e avisam na mesma
  // rodada; o que importa aqui é o recado DESTE.
  const meus = avisos().slice(antes).filter((n) => /Hoje/.test(n.message));
  assert.equal(meus.length, 1);
  assert.match(meus[0].message, /Retornar hoje/);
  assert.match(meus[0].message, /ligar de manhã/);

  const antes2 = avisos().length;
  lembrarRetornos(org);
  assert.equal(avisos().slice(antes2).filter((n) => /Hoje/.test(n.message)).length, 0,
    "abrir as notificações de novo não duplica o recado");
});

test("atrasado continua incomodando, e diz desde quando", async () => {
  const p = novoProspect("Atrasado");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(-4) });
  const antes = avisos().length;
  lembrarRetornos(org);
  const novo = avisos().slice(antes).find((n) => /Atrasado/.test(n.message));
  assert.ok(novo, "avisou");
  assert.match(novo.message, /Retorno atrasado/);
  assert.match(novo.message, new RegExp(dias(-4).slice(0, 10).split("-").reverse().join("/")));
});

test("o aviso vai para quem ficou responsável", async () => {
  const p = novoProspect("DoRafa");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: hoje(), assignee_id: rafa });
  const antes = avisos().length;
  lembrarRetornos(org);
  const novo = avisos().slice(antes).find((n) => /DoRafa/.test(n.message));
  assert.equal(novo.user_id, rafa, "mirado, não para a equipe inteira");
});

// ESTE CASO MUDOU, A PEDIDO DELA.
//
// "quando eu marcar na prospecção que eu tenho que retornar em tal data, NA
// SEMANA vai aparecer pra mim uma notificação". Antes o primeiro sinal era no
// próprio dia — tarde para quem precisa preparar a conversa.
test("entrando na semana, avisa UMA vez — e não todo dia", async () => {
  const p = novoProspect("Semana que vem");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(6) });

  const antes = avisos().length;
  lembrarRetornos(org);
  const meus = avisos().slice(antes).filter((n) => /Semana que vem/.test(n.message));
  assert.equal(meus.length, 1, "um recado, já na semana");
  assert.match(meus[0].message, /Retornar em/, "diz o dia, não 'hoje'");
  assert.match(meus[0].message, new RegExp(dias(6).slice(0, 10).split("-").reverse().join("/")));

  // No dia seguinte (o controle guarda o dia), nada de novo até chegar a data.
  db.prepare("UPDATE prospects SET retorno_avisado_em = date('now','-1 day') WHERE id = ?").run(p);
  const antes2 = avisos().length;
  lembrarRetornos(org);
  assert.equal(avisos().slice(antes2).filter((n) => /Semana que vem/.test(n.message)).length, 0,
    "avisar todo dia por uma semana ensina a ignorar o sininho");
});

test("data longe não aparece nem no sininho", async () => {
  const p = novoProspect("Daqui a dois meses");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(60) });
  const antes = avisos().length;
  lembrarRetornos(org);
  assert.ok(!avisos().slice(antes).some((n) => /dois meses/.test(n.message)));
});

test("quem já virou cliente (ou não rolou) não é cobrado de retorno", async () => {
  for (const status of ["fechado", "perdido"]) {
    const p = novoProspect(`Encerrado-${status}`);
    await pedir("PUT", `/prospects/${p}/retorno`, { data: hoje() });
    db.prepare("UPDATE prospects SET status = ?, retorno_avisado_em = NULL WHERE id = ?").run(status, p);
    const antes = avisos().length;
    lembrarRetornos(org);
    assert.ok(!avisos().slice(antes).some((n) => new RegExp(`Encerrado-${status}`).test(n.message)),
      `${status} não gera cobrança de retorno`);
  }
});

test("remarcar a data devolve o direito de avisar no mesmo dia", async () => {
  const p = novoProspect("Remarcado");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: hoje() });
  lembrarRetornos(org);                                   // avisou hoje
  assert.equal(lerProspect(p).retorno_avisado_em, hoje());

  await pedir("PUT", `/prospects/${p}/retorno`, { data: hoje(), nota: "mudou o combinado" });
  assert.equal(lerProspect(p).retorno_avisado_em, null, "data nova, recado novo");
  const antes = avisos().length;
  lembrarRetornos(org);
  assert.ok(avisos().slice(antes).some((n) => /mudou o combinado/.test(n.message)));
});

test("o aviso não atravessa para outra casa", () => {
  const outra = db.prepare("SELECT id FROM organizations WHERE name = 'Vizinha'").get().id;
  const alheio = db.prepare("INSERT INTO prospects (org_id,name,status,retorno_em) VALUES (?,'Da vizinha','novo',?)")
    .run(outra, hoje()).lastInsertRowid;
  const antes = avisos().length;
  lembrarRetornos(org);
  assert.ok(!avisos().slice(antes).some((n) => /Da vizinha/.test(n.message)));
  assert.equal(lerProspect(alheio).retorno_avisado_em, null, "nem marcou como avisado");
});

test("abrir as notificações dispara o lembrete sozinho", async () => {
  const p = novoProspect("PelaSineta");
  marcarRetorno(org, p, { data: hoje() });
  const r = await pedir("GET", "/notifications");
  assert.equal(r.status, 200);
  assert.ok(r.corpo.some((n) => /PelaSineta/.test(n.message)), "o aviso já veio na lista");
});

// --- o que a tela promete ------------------------------------------------------

const aqui = dirname(fileURLToPath(import.meta.url));
const tela = readFileSync(join(aqui, "../../client/src/pages/Prospects.jsx"), "utf8");
const quadro = readFileSync(join(aqui, "../../client/src/pages/Priorities.jsx"), "utf8");

test("o cartão da Prospecção tem onde marcar o retorno", () => {
  assert.match(tela, /retorno_em/, "mostra a data marcada");
  assert.match(tela, /\/retorno/, "fala com a rota");
});

test("o quadro de Prioridades mostra a data", () => {
  assert.match(quadro, /due_date/);
});
