import { db } from "./db.js";

// ---------------------------------------------------------------------------
// TAREFA AGRUPADA SE ABRE EM PEÇAS NA DISTRIBUIÇÃO.
//
// No quadro de Tarefas, um mês de conteúdo é UM cartão com um "×8" — oito posts
// combinados. Na Distribuição, cada post é uma peça: tem a sua arte, a sua
// legenda e a sua data.
//
// Pedido dela: "quando chega na aba de Distribuição, tem que abrir todos os
// posts na aba de Distribuição".
//
// Isto já existia, mas só no ARRASTAR do quadro: a tarefa que chegou à coluna
// por qualquer outro caminho — criada direto ali, trazida do Planejamento —
// ficava parada, agrupada, e a Distribuição mostrava uma peça só no lugar de
// oito. Agora a abertura também acontece ao LISTAR a Distribuição: quem estiver
// agrupado na coluna se abre na hora, sem depender de como chegou lá.
// ---------------------------------------------------------------------------

export const ehDistribuicao = (nome) => /distribui/i.test(String(nome ?? ""));

/**
 * O nome de cada peça: "Post — Cliente (Outubro/2026)" vira
 * "Post 1/8 — Cliente (Outubro/2026)".
 */
export function nomeDaPeca(titulo, i, n) {
  const t = String(titulo ?? "").trim();
  const base = t.replace(/\s+—.*$/, "");
  const sufixo = t.match(/—.*$/)?.[0] || "";
  return `${base} ${i}/${n}${sufixo ? " " + sufixo : ""}`.trim();
}

const AGRUPADAS_DA_ETAPA = `
  SELECT * FROM tasks WHERE org_id = ? AND stage_id = ? AND quantity > 1`;

/**
 * Abre UMA tarefa agrupada em N peças, no lugar dela.
 *
 * A posição das peças fica em ZERO de propósito. Nesta coluna, `position` tem
 * dois trabalhos: ordenar o cartão no quadro e marcar, na prévia do perfil,
 * "esta peça foi arrumada à mão". Numerando as peças de 1 a N, as oito nasciam
 * com cara de arrumadas à mão e furavam a fila do perfil, na frente de tudo.
 * Com zero, o quadro as ordena pelo id — que é justamente 1/8, 2/8, 3/8… — e o
 * perfil as trata como peça nova, que é o que elas são.
 */
export function abrirAgrupada(orgId, task) {
  const n = Number(task.quantity);
  if (!Number.isFinite(n) || n <= 1) return 0;
  const insPeca = db.prepare(
    `INSERT INTO tasks (title, description, client_id, project_id, assignee_id, stage_id, priority,
       tags, due_date, ref_month, content_type, caption, bonus, quantity, position, org_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`
  );
  db.transaction(() => {
    for (let i = 1; i <= n; i++) {
      insPeca.run(
        nomeDaPeca(task.title, i, n),
        task.description, task.client_id, task.project_id, task.assignee_id, task.stage_id,
        task.priority, task.tags, task.due_date, task.ref_month, task.content_type, task.caption,
        task.bonus ? 1 : 0, orgId
      );
    }
    db.prepare("DELETE FROM tasks WHERE id = ? AND org_id = ?").run(task.id, orgId);
  })();
  return n;
}

/** Abre tudo o que estiver agrupado naquela etapa. Devolve quantas peças nasceram. */
export function abrirAgrupadasDaEtapa(orgId, stageId) {
  if (!orgId || !stageId) return 0;
  const agrupadas = db.prepare(AGRUPADAS_DA_ETAPA).all(orgId, stageId);
  let pecas = 0;
  for (const t of agrupadas) pecas += abrirAgrupada(orgId, t);
  return pecas;
}
