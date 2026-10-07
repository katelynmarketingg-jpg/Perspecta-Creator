import { db } from "./db.js";
import { metaConfigured } from "./meta.js";
import { publishTask } from "./routes/integrations.js";
import { comecarPublicacao, terminarPublicacao } from "./publicacao-demorada.js";
import { agoraNaAgencia } from "./fuso.js";

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

const hoje = () => agoraNaAgencia().slice(0, 10);

/**
 * O que está pronto e dentro da janela — o que de fato pode ir ao ar.
 *
 * @agora é a hora DAQUI, não a de Greenwich. Sem isso, um post marcado para
 * as 15:25 contava como vencido às 12:25 — ver fuso.js.
 */
export function prontosParaPublicar() {
  return db.prepare(`
    SELECT t.*, c.name AS client_name
    FROM tasks t
    JOIN clients c ON c.id = t.client_id
    JOIN integrations i ON i.client_id = c.id AND i.provider = 'meta'
    WHERE c.auto_publish = 1
      AND t.published_at IS NULL
      AND t.scheduled_at IS NOT NULL
      AND datetime(t.scheduled_at) <= datetime(@agora)
      AND datetime(t.scheduled_at) > datetime(@agora, @janela)
      -- Só o que foi programado depois de o automático ser ligado.
      AND (c.auto_publish_desde IS NULL OR datetime(t.scheduled_at) >= datetime(c.auto_publish_desde))
      AND t.approval_status = 'approved'
      AND EXISTS (SELECT 1 FROM task_attachments ta WHERE ta.task_id = t.id)
  `).all({ agora: agoraNaAgencia(), janela: JANELA_DE_ATRASO });
}

/**
 * Peças que passaram da hora e NÃO vão sair sozinhas.
 *
 * É o buraco que existia: ficavam paradas sem ninguém saber. E o aviso agora
 * DIZ O PORQUÊ — era exatamente a pergunta dela depois de um post aprovado
 * não entrar na hora marcada. São quatro motivos, e só eles:
 *
 *   • sem arte anexada     — não dá para publicar, nem na mão (este era o pior:
 *                            a peça não entrava nem na lista de atrasadas);
 *   • automático desligado — o interruptor do cliente, em Integrações;
 *   • programado antes     — o automático só pega o que foi marcado depois de
 *                            ele ser ligado, para não despejar atrasados;
 *   • fora da janela       — passou das 48h de corrida atrás do prejuízo.
 *
 * O que ainda vai sair sozinho não entra aqui. Avisa uma vez por peça
 * (aviso_atraso_em guarda o dia).
 */
export function avisarAtrasados(orgId = null) {
  const where = [
    "t.published_at IS NULL",
    "t.scheduled_at IS NOT NULL",
    "datetime(t.scheduled_at) <= datetime(@agora)",
    "t.approval_status = 'approved'",
    "t.aviso_atraso_em IS NULL",
  ];
  const params = { janela: JANELA_DE_ATRASO, agora: agoraNaAgencia() };
  if (orgId) { where.push("t.org_id = @org_id"); params.org_id = orgId; }

  const candidatos = db.prepare(
    `SELECT t.id, t.title, t.client_id, t.org_id, t.scheduled_at,
            c.auto_publish, c.auto_publish_desde,
            EXISTS (SELECT 1 FROM task_attachments ta WHERE ta.task_id = t.id) AS tem_arte,
            (datetime(t.scheduled_at) <= datetime(@agora, @janela)) AS fora_da_janela
       FROM tasks t JOIN clients c ON c.id = t.client_id
      WHERE ${where.join(" AND ")}`
  ).all(params);

  const atrasados = [];
  for (const t of candidatos) {
    const motivo = porQueNaoSai(t);
    if (motivo) atrasados.push({ ...t, motivo });
  }
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
        `⏰ "${t.title}" passou da hora (${quando}) e não foi publicado. ${t.motivo}`,
        t.org_id);
      marca.run(dia, t.id);
    }
  });
  tx();
  return atrasados.length;
}

/**
 * Por que esta peça não vai ao ar sozinha — em uma frase, para ela ler.
 * Devolve null quando o robô ainda vai pegá-la: aí não é atraso, é fila.
 */
function porQueNaoSai(t) {
  if (!t.tem_arte) return "Falta a arte: anexe o arquivo na peça, em Distribuição.";
  if (!t.auto_publish) return "A publicação automática está desligada neste cliente (Integrações).";
  if (t.auto_publish_desde && String(t.scheduled_at) < String(t.auto_publish_desde).replace("T", " ")) {
    return "Já estava programado quando o automático foi ligado — o robô não pega os de antes. Publique na peça, em Distribuição.";
  }
  if (t.fora_da_janela) return "Passou das 48h em que o robô ainda tentaria. Publique na peça, em Distribuição.";
  return null;
}

/**
 * A FILA DO AUTOMÁTICO, PARA ELA OLHAR ANTES DE CONFIAR.
 *
 * Pedido dela: "confere para mim se realmente os aprovados vão ser postados
 * conforme as datas... eu tô com receio desses que vão entrar sozinhos."
 *
 * Conferir uma vez não resolve: o que ela precisa é ver, a qualquer dia, o que
 * vai sair sozinho e o que está marcado mas NÃO vai sair — com o motivo. É
 * exatamente a mesma leitura que o robô faz na hora de publicar, só que olhando
 * para a frente.
 */
export function filaDoAutomatico(orgId, clientId, dias = 30) {
  const agora = agoraNaAgencia();
  const marcadas = db.prepare(
    `SELECT t.id, t.title, t.scheduled_at, t.approval_status,
            c.auto_publish, c.auto_publish_desde,
            EXISTS (SELECT 1 FROM task_attachments ta WHERE ta.task_id = t.id) AS tem_arte
       FROM tasks t JOIN clients c ON c.id = t.client_id
      WHERE t.org_id = @org AND t.client_id = @cli
        AND t.published_at IS NULL
        AND t.scheduled_at IS NOT NULL
        AND datetime(t.scheduled_at) > datetime(@agora, @janela)
        AND datetime(t.scheduled_at) <= datetime(@agora, @ate)
      ORDER BY t.scheduled_at`
  ).all({ org: orgId, cli: clientId, agora, janela: JANELA_DE_ATRASO, ate: `+${dias} days` });

  const proximas = [], travadas = [];
  for (const t of marcadas) {
    const motivo = !t.tem_arte ? "sem arte anexada"
      : t.approval_status !== "approved" ? "o cliente ainda não aprovou"
      : !t.auto_publish ? "publicação automática desligada neste cliente"
      : (t.auto_publish_desde && String(t.scheduled_at) < String(t.auto_publish_desde).replace("T", " "))
        ? "já estava programada quando o automático foi ligado"
        : null;
    (motivo ? travadas : proximas).push({
      id: t.id, title: t.title, scheduled_at: t.scheduled_at, ...(motivo ? { motivo } : {}),
    });
  }
  return { proximas, travadas };
}

/**
 * Publica sozinho os posts cuja hora chegou — mas só para clientes em que a
 * publicação automática foi ligada de propósito. Sem isso, nada sai no ar
 * sem alguém apertar o botão.
 */
export async function runAutoPublish() {
  // Sem a Meta configurada nada publica — mas o aviso de atraso TEM de sair
  // assim mesmo. Antes esta linha voltava calada, e o resultado era o pior
  // dos mundos: o post não ia ao ar e ninguém ficava sabendo.
  if (!metaConfigured()) {
    return { publicados: 0, motivo: "Meta não configurada", atrasados: avisarAtrasados() };
  }

  const prontos = prontosParaPublicar();

  let publicados = 0;
  for (const task of prontos) {
    // O MESMO PORTÃO DO BOTÃO. Sem isto, o automático podia pegar uma peça que
    // alguém acabou de mandar publicar na mão — e ela ia ao ar duas vezes.
    if (!comecarPublicacao(task.id, task.org_id)) continue;
    try {
      await publishTask(task, task.org_id, null, "https");
      publicados++;
    } catch (e) {
      db.prepare("UPDATE tasks SET publish_error = ? WHERE id = ?").run(e.message, task.id);
      db.prepare(
        "INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', ?, ?, ?, ?)"
      ).run(task.client_id, task.id, `⚠️ Falha ao publicar "${task.title}": ${e.message}`, task.org_id);
    } finally {
      terminarPublicacao(task.id, task.org_id);
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
