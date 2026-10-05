import { db } from "./db.js";

// ---------------------------------------------------------------------------
// "RETORNAR EM": a data de voltar a falar com quem está na Prospecção.
//
// O pedido dela: "ele tem primeiro contato, mas nem está mais no primeiro
// contato. Quero poder colocar ali dentro uma tarefa de chamar novamente, e
// botar a data. E daí essa data vai aparecer para mim nas Prioridades."
//
// POR QUE EM PRIORIDADES E NÃO EM TAREFAS
//
// Tarefas é o quadro da produção do cliente — peça que nasce, é aprovada e vai
// ao ar. Um retorno de venda ali entraria numa coluna de conteúdo, contaria
// junto nos números de entrega e sujaria o quadro. Prioridades é exatamente o
// contrário: é o canal interno de "o que precisa de atenção", já tem nível,
// responsável e aviso mirado em quem vai fazer. O retorno é isso.
//
// COMO OS DOIS FICAM LIGADOS
//
// A data mora no prospect (é dele), e cada prospect tem NO MÁXIMO UMA
// prioridade de retorno aberta — remarcar a data não empilha recado novo, muda
// a que já existe. Concluída a prioridade, o retorno sai do cartão: quem
// resolve marca ali, não em dois lugares.
// ---------------------------------------------------------------------------

const MARCA = "Retornar:";     // como o recado começa — é por ele que a gente se reencontra
const NIVEIS = ["alta", "media", "baixa"];

const hoje = () => new Date().toISOString().slice(0, 10);
const soData = (v) => (v ? String(v).trim().slice(0, 10) : null);

/** A prioridade de retorno AINDA ABERTA deste prospect, se houver. */
export function prioridadeDoRetorno(orgId, prospectId) {
  return db.prepare(
    `SELECT * FROM priorities
      WHERE org_id = ? AND prospect_id = ? AND status != 'done'
      ORDER BY id DESC LIMIT 1`
  ).get(orgId, prospectId);
}

/** O recado que aparece no quadro. Curto: o nome manda, a nota complementa. */
function recado(prospect, nota) {
  const quem = [prospect.name, prospect.company].filter(Boolean).join(" — ");
  return `${MARCA} ${quem}${nota ? ` · ${nota}` : ""}`;
}

/**
 * Marca (ou remarca) o retorno de um prospect.
 *
 * Devolve { prospect, priority }. Sem data, é o mesmo que limpar.
 */
export function marcarRetorno(orgId, prospectId, dados = {}) {
  const prospect = db.prepare("SELECT * FROM prospects WHERE id = ? AND org_id = ?").get(prospectId, orgId);
  if (!prospect) return null;

  const data = soData(dados.data ?? dados.retorno_em);
  if (!data) return limparRetorno(orgId, prospectId);

  const nota = (dados.nota ?? dados.retorno_nota ?? "").trim() || null;
  const nivel = NIVEIS.includes(dados.level) ? dados.level : "media";
  const responsavel = dados.assignee_id || null;

  // Remarcar uma data LIMPA o controle do aviso: a data nova merece o seu
  // recado, mesmo que a antiga já tivesse avisado hoje.
  db.prepare(
    "UPDATE prospects SET retorno_em = ?, retorno_nota = ?, retorno_avisado_em = NULL WHERE id = ? AND org_id = ?"
  ).run(data, nota, prospectId, orgId);

  const atualizado = { ...prospect, retorno_em: data, retorno_nota: nota };
  const aberta = prioridadeDoRetorno(orgId, prospectId);

  if (aberta) {
    db.prepare(
      "UPDATE priorities SET message = ?, level = ?, assignee_id = ?, due_date = ? WHERE id = ? AND org_id = ?"
    ).run(recado(atualizado, nota), nivel, responsavel, data, aberta.id, orgId);
    return { prospect: atualizado, priority: db.prepare("SELECT * FROM priorities WHERE id = ?").get(aberta.id) };
  }

  const info = db.prepare(
    `INSERT INTO priorities (org_id, client_id, message, level, assignee_id, created_by, status, due_date, prospect_id)
     VALUES (?, NULL, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(orgId, recado(atualizado, nota), nivel, responsavel, dados.created_by || null, data, prospectId);

  return { prospect: atualizado, priority: db.prepare("SELECT * FROM priorities WHERE id = ?").get(info.lastInsertRowid) };
}

/** Tira o retorno: some a data do cartão e a prioridade aberta que era dela. */
export function limparRetorno(orgId, prospectId) {
  const prospect = db.prepare("SELECT * FROM prospects WHERE id = ? AND org_id = ?").get(prospectId, orgId);
  if (!prospect) return null;
  db.prepare(
    "UPDATE prospects SET retorno_em = NULL, retorno_nota = NULL, retorno_avisado_em = NULL WHERE id = ? AND org_id = ?"
  ).run(prospectId, orgId);
  // Só a ABERTA. O que já foi concluído é histórico do quadro e fica.
  db.prepare("DELETE FROM priorities WHERE org_id = ? AND prospect_id = ? AND status != 'done'")
    .run(orgId, prospectId);
  return { prospect: { ...prospect, retorno_em: null, retorno_nota: null }, priority: null };
}

/**
 * Concluída a prioridade, o retorno sai do cartão da Prospecção.
 *
 * Sem isto, quem arrastasse o recado para "Concluído" continuaria vendo
 * "Retornar em 10/08" no cartão — dois lugares contando histórias diferentes.
 */
export function retornoConcluido(orgId, priorityId) {
  const p = db.prepare("SELECT prospect_id, status FROM priorities WHERE id = ? AND org_id = ?").get(priorityId, orgId);
  if (!p?.prospect_id || p.status !== "done") return false;
  db.prepare(
    "UPDATE prospects SET retorno_em = NULL, retorno_nota = NULL, retorno_avisado_em = NULL WHERE id = ? AND org_id = ?"
  ).run(p.prospect_id, orgId);
  return true;
}

/** Quantos dias antes da data o retorno comece a existir para a equipe. */
export const ANTECEDENCIA_DIAS = 7;

/**
 * Avisa os retornos: um recado quando entram na semana, e depois no dia.
 *
 * Palavras dela: "quando eu marcar na prospecção que eu tenho que retornar em
 * tal data, NA SEMANA vai aparecer pra mim uma notificação". Antes o primeiro
 * sinal era no próprio dia — tarde demais para quem precisa preparar a
 * conversa, e cedo demais no quadro, onde o recado aparecia desde o dia em que
 * a data foi marcada.
 *
 * Então são dois momentos, e nunca mais de um recado por dia por prospect:
 *
 *   · UMA VEZ, ao entrar na semana — "retornar em 10/12";
 *   · no dia e em cada dia depois, enquanto ninguém resolver — um retorno
 *     esquecido tem de continuar incomodando.
 *
 * O meio do caminho fica calado de propósito: avisar todo dia por uma semana
 * ensina a ignorar o sininho.
 *
 * Mesmo desenho do aviso de cobrança atrasada: o Render é uma instância só, sem
 * agendador, então a checagem roda quando alguém abre as notificações, e o
 * retorno_avisado_em impede repetir no mesmo dia.
 *
 * O aviso é mirado: vai para quem ficou responsável pela prioridade; sem
 * responsável, vai para a equipe (user_id nulo).
 */
export function lembrarRetornos(orgId) {
  if (!orgId) return 0;
  const dia = hoje();
  const vencidos = db.prepare(
    `SELECT p.id, p.name, p.company, p.retorno_em, p.retorno_nota, p.retorno_avisado_em,
            (SELECT pr.assignee_id FROM priorities pr
              WHERE pr.prospect_id = p.id AND pr.org_id = p.org_id AND pr.status != 'done'
              ORDER BY pr.id DESC LIMIT 1) AS assignee_id
       FROM prospects p
      WHERE p.org_id = ?
        AND p.retorno_em IS NOT NULL
        AND (p.retorno_avisado_em IS NULL OR date(p.retorno_avisado_em) < date(?))
        AND p.status NOT IN ('fechado', 'perdido')
        AND (
          -- chegou o dia (ou passou): cobra todo dia
          date(p.retorno_em) <= date(?)
          -- ou entrou na semana, e ainda não foi avisado nenhuma vez
          OR (p.retorno_avisado_em IS NULL
              AND date(p.retorno_em) <= date(?, '+${ANTECEDENCIA_DIAS} days'))
        )`
  ).all(orgId, dia, dia, dia);

  if (!vencidos.length) return 0;

  const ins = db.prepare(
    "INSERT INTO notifications (audience, client_id, message, org_id, user_id) VALUES ('agency', NULL, ?, ?, ?)"
  );
  const marca = db.prepare("UPDATE prospects SET retorno_avisado_em = ? WHERE id = ?");

  const tx = db.transaction(() => {
    for (const v of vencidos) {
      const quem = [v.name, v.company].filter(Boolean).join(" — ");
      const data = v.retorno_em.slice(0, 10);
      const quando = data.split("-").reverse().join("/");
      const cabecalho = data < dia ? `⏰ Retorno atrasado (era ${quando})`
        : data === dia ? "📞 Retornar hoje"
        : `📅 Retornar em ${quando}`;
      ins.run(`${cabecalho}: ${quem}${v.retorno_nota ? ` · ${v.retorno_nota}` : ""}`,
        orgId, v.assignee_id || null);
      marca.run(dia, v.id);
    }
  });
  tx();
  return vencidos.length;
}
