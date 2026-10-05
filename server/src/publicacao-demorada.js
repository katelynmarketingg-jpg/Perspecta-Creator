import { db } from "./db.js";
import { agoraNaAgencia } from "./fuso.js";

// ---------------------------------------------------------------------------
// PUBLICAR SEM SEGURAR O CLIQUE, E AVISAR ANTES DO TOKEN VENCER
//
// Dois problemas que ficaram de fora da correção do carrossel, porque mudam o
// jeito de funcionar e não eram remendo:
//
// 1. VÍDEO ESTOURAVA O TEMPO. A Meta baixa e processa o vídeo antes de
//    publicar, e a gente espera até 2 minutos por isso. Esperar dentro do
//    pedido HTTP fazia o navegador desistir: a pessoa via erro de demora
//    mesmo quando o post ia ao ar logo depois — e, pior, podia clicar de novo.
//    Agora o pedido volta na hora e o trabalho continua aqui, com aviso no
//    fim, dando certo ou dando errado.
//
// 2. O TOKEN VENCIA EM SILÊNCIO. token_expires era gravado e nunca lido.
//    Quando vencesse, a publicação passaria a falhar sem ninguém ter sido
//    avisado antes. Agora avisa com antecedência, uma vez por dia.
// ---------------------------------------------------------------------------

/** Depois disto, uma publicação pendurada é dada como perdida (servidor caiu). */
export const LIMITE_PENDURADO_MIN = 20;

/** A partir de quantos dias para vencer o token começa a avisar. */
export const AVISAR_TOKEN_DIAS = 10;

// O dia DAQUI: a guarda é "uma vez por dia", e o dia é o nosso.
const hoje = () => agoraNaAgencia().slice(0, 10);

/**
 * Segura o portão: marca que esta peça começou a publicar.
 *
 * Devolve false se já tem uma publicação em andamento — é o que impede dois
 * cliques virarem dois posts. Uma marca velha (servidor caiu no meio) não
 * tranca para sempre: passa do limite, vale como livre.
 */
export function comecarPublicacao(taskId, orgId) {
  const info = db.prepare(
    `UPDATE tasks SET publicando_desde = datetime('now')
      WHERE id = ? AND org_id = ? AND published_at IS NULL
        AND (publicando_desde IS NULL
             OR datetime(publicando_desde) < datetime('now', ?))`
  ).run(taskId, orgId, `-${LIMITE_PENDURADO_MIN} minutes`);
  return info.changes > 0;
}

export function terminarPublicacao(taskId, orgId) {
  db.prepare("UPDATE tasks SET publicando_desde = NULL WHERE id = ? AND org_id = ?").run(taskId, orgId);
}

/** Esta peça tem vídeo? É o que decide esperar ou não pelo resultado. */
export function temVideo(midias) {
  return midias.some((m) => (m.mime || "").startsWith("video"));
}

/**
 * Publicações que ficaram penduradas (o servidor reiniciou no meio).
 *
 * Roda ao subir. A peça volta a poder ser publicada, e fica o aviso — porque o
 * post PODE ter ido ao ar: quem decide se tenta de novo é quem olha o perfil.
 */
export function soltarPenduradas() {
  const presas = db.prepare(
    `SELECT id, title, client_id, org_id FROM tasks
      WHERE publicando_desde IS NOT NULL
        AND published_at IS NULL
        AND datetime(publicando_desde) < datetime('now', ?)`
  ).all(`-${LIMITE_PENDURADO_MIN} minutes`);
  if (!presas.length) return 0;

  const limpa = db.prepare("UPDATE tasks SET publicando_desde = NULL WHERE id = ?");
  const avisa = db.prepare(
    "INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', ?, ?, ?, ?)"
  );
  const tx = db.transaction(() => {
    for (const t of presas) {
      limpa.run(t.id);
      avisa.run(t.client_id, t.id,
        `⚠️ "${t.title}" ficou no meio da publicação e não deu para confirmar. `
        + "Confira no Instagram antes de publicar de novo.", t.org_id);
    }
  });
  tx();
  return presas.length;
}

/**
 * Avisa quando o token da Meta está perto de vencer — ou já venceu.
 *
 * Mesmo desenho dos outros lembretes (a checagem roda quando alguém abre as
 * notificações, com guarda de um por dia). Sem isto, o primeiro sinal de que o
 * token venceu seria um post que não foi ao ar.
 */
export function avisarTokensVencendo(orgId) {
  if (!orgId) return 0;
  const dia = hoje();
  const alvos = db.prepare(
    `SELECT i.client_id, i.token_expires, i.ig_username, i.page_name, c.name AS client_name
       FROM integrations i JOIN clients c ON c.id = i.client_id
      WHERE i.org_id = ? AND i.provider = 'meta'
        AND i.token_expires IS NOT NULL
        AND datetime(i.token_expires) <= datetime('now', ?)
        AND (i.aviso_token_em IS NULL OR date(i.aviso_token_em) < date(?))`
  ).all(orgId, `+${AVISAR_TOKEN_DIAS} days`, dia);
  if (!alvos.length) return 0;

  const avisa = db.prepare(
    "INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('agency', ?, ?, ?)"
  );
  const marca = db.prepare(
    "UPDATE integrations SET aviso_token_em = ? WHERE client_id = ? AND org_id = ? AND provider = 'meta'"
  );
  const tx = db.transaction(() => {
    for (const a of alvos) {
      // O @ entra uma vez só: a Meta devolve o usuário sem arroba, mas dado
      // antigo (ou importado na mão) pode já vir com ela — e virava "@@".
      const quem = a.ig_username
        ? `@${String(a.ig_username).replace(/^@+/, "")}`
        : (a.page_name || a.client_name);
      const vencido = new Date(a.token_expires) <= new Date();
      const quando = String(a.token_expires).slice(0, 10).split("-").reverse().join("/");
      avisa.run(a.client_id,
        vencido
          ? `🔑 A conexão com a Meta de ${quem} venceu em ${quando}. Reconecte em Integrações — nada publica até lá.`
          : `🔑 A conexão com a Meta de ${quem} vence em ${quando}. Reconecte em Integrações para não parar de publicar.`,
        orgId);
      marca.run(dia, a.client_id, orgId);
    }
  });
  tx();
  return alvos.length;
}

/** Quantos dias faltam para o token vencer (null quando não há data). */
export function diasAteVencer(tokenExpires) {
  if (!tokenExpires) return null;
  const ms = new Date(tokenExpires).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86400000);
}
