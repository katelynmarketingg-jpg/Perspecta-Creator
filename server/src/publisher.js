import { db } from "./db.js";
import { metaConfigured } from "./meta.js";
import { publishTask } from "./routes/integrations.js";

// ---------------------------------------------------------------------------
// PUBLICAÇÃO AUTOMÁTICA
//
// Três regras que vieram de um problema real: ela conectou a página em
// Integrações e nada foi publicado. O interruptor "Publicar sozinho" nasce
// desligado (continua assim — publicar é irreversível), mas havia duas falhas
// de verdade além disso:
//
// 1. A peça que perdesse a janela era IGNORADA EM SILÊNCIO, para sempre.
//    Agora ela vira aviso: "passou da hora e não foi publicado".
//
// 2. A janela era de 1 dia. Um restart do servidor na hora errada, ou a Meta
//    fora do ar por algumas horas, e o post sumia do radar. Agora são 48h de
//    corrida atrás do prejuízo.
//
// E, porque a janela cresceu, uma trava nova: o automático só vale para o que
// foi programado DEPOIS de o interruptor ser ligado (clients.auto_publish_desde).
// Sem ela, ligar o interruptor hoje jogaria no ar dois dias de posts atrasados
// de uma vez.
// ---------------------------------------------------------------------------

/** Quanto tempo depois da hora marcada ainda vale publicar sozinho. */
export const JANELA_DE_ATRASO = "-48 hours";

const hoje = () => new Date().toISOString().slice(0, 10);

/** O que está pronto e dentro da janela — o que de fato pode ir ao ar. */
function prontosParaPublicar() {
  return db.prepare(`
    SELECT t.*, c.name AS client_name
    FROM tasks t
    JOIN clients c ON c.id = t.client_id
    JOIN integrations i ON i.client_id = c.id AND i.provider = 'meta'
    WHERE c.auto_publish = 1
      AND t.published_at IS NULL
      AND t.scheduled_at IS NOT NULL
      AND datetime(t.scheduled_at) <= datetime('now')
      AND datetime(t.scheduled_at) > datetime('now', ?)
      -- Só o que foi programado depois de o automático ser ligado.
      AND (c.auto_publish_desde IS NULL OR datetime(t.scheduled_at) >= datetime(c.auto_publish_desde))
      AND t.approval_status = 'approved'
      AND EXISTS (SELECT 1 FROM task_attachments ta WHERE ta.task_id = t.id)
  `).all(JANELA_DE_ATRASO);
}

/**
 * Peças que passaram da hora e NÃO vão sair sozinhas.
 *
 * É o buraco que existia: ficavam paradas sem ninguém saber. Entram aqui tanto
 * as que passaram da janela quanto as que estavam programadas de antes de o
 * automático ser ligado — em todos os casos alguém precisa publicar na mão.
 * Avisa uma vez por peça (aviso_atraso_em guarda o dia).
 */
export function avisarAtrasados(orgId = null) {
  const where = [
    "t.published_at IS NULL",
    "t.scheduled_at IS NOT NULL",
    "datetime(t.scheduled_at) <= datetime('now')",
    "t.approval_status = 'approved'",
    "t.aviso_atraso_em IS NULL",
    "EXISTS (SELECT 1 FROM task_attachments ta WHERE ta.task_id = t.id)",
    // Fora do alcance do automático: ou passou da janela, ou o cliente não tem
    // automático ligado, ou foi programada antes de ele ser ligado.
    `(datetime(t.scheduled_at) <= datetime('now', @janela)
      OR c.auto_publish = 0
      OR (c.auto_publish_desde IS NOT NULL AND datetime(t.scheduled_at) < datetime(c.auto_publish_desde)))`,
  ];
  const params = { janela: JANELA_DE_ATRASO };
  if (orgId) { where.push("t.org_id = @org_id"); params.org_id = orgId; }

  const atrasados = db.prepare(
    `SELECT t.id, t.title, t.client_id, t.org_id, t.scheduled_at, c.auto_publish
       FROM tasks t JOIN clients c ON c.id = t.client_id
      WHERE ${where.join(" AND ")}`
  ).all(params);
  if (!atrasados.length) return 0;

  const ins = db.prepare(
    "INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', ?, ?, ?, ?)"
  );
  const marca = db.prepare("UPDATE tasks SET aviso_atraso_em = ? WHERE id = ?");
  const dia = hoje();

  const tx = db.transaction(() => {
    for (const t of atrasados) {
      const quando = String(t.scheduled_at).slice(0, 16).replace("T", " ");
      ins.run(t.client_id, t.id,
        `⏰ "${t.title}" passou da hora (${quando}) e não foi publicado.`
        + (t.auto_publish ? " Publique na peça, em Distribuição." : " A publicação automática está desligada neste cliente."),
        t.org_id);
      marca.run(dia, t.id);
    }
  });
  tx();
  return atrasados.length;
}

/**
 * Publica sozinho os posts cuja hora chegou — mas só para clientes em que a
 * publicação automática foi ligada de propósito. Sem isso, nada sai no ar
 * sem alguém apertar o botão.
 */
export async function runAutoPublish() {
  if (!metaConfigured()) return { publicados: 0, motivo: "Meta não configurada" };

  const prontos = prontosParaPublicar();

  let publicados = 0;
  for (const task of prontos) {
    try {
      await publishTask(task, task.org_id, null, "https");
      publicados++;
    } catch (e) {
      db.prepare("UPDATE tasks SET publish_error = ? WHERE id = ?").run(e.message, task.id);
      db.prepare(
        "INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', ?, ?, ?, ?)"
      ).run(task.client_id, task.id, `⚠️ Falha ao publicar "${task.title}": ${e.message}`, task.org_id);
    }
  }
  // Depois de tentar, cobra o que ficou para trás — inclusive o que acabou de
  // sair da janela nesta rodada.
  const atrasados = avisarAtrasados();
  return { publicados, avaliados: prontos.length, atrasados };
}

export function startPublisher() {
  const CINCO_MIN = 5 * 60 * 1000;
  setInterval(() => {
    runAutoPublish().catch((e) => console.error("auto-publicação:", e.message));
  }, CINCO_MIN).unref?.();
}
