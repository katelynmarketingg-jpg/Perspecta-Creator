import { db } from "./db.js";
import { CAMPOS_CLIENTE, respostasParaCliente, respostasParaCentral, getTemplate } from "./briefing.js";
import { guardaNaCentral } from "./central.js";
import { geraContrato } from "./contract-gen.js";

// ---------------------------------------------------------------------------
// O que acontece SOZINHO quando o cliente termina de responder o onboarding.
//
// A agência não precisa estar na frente do computador: o cadastro dele já fica
// preenchido, as senhas que ele passou já vão para a Central (criptografadas) e
// o contrato já nasce pronto para assinar, com os termos que ela definiu ao
// abrir o onboarding. Ela só acompanha.
//
// A inteligência da IA continua sendo aplicada por ela, com o botão — ali é
// texto que costuma valer uma lida antes de virar a voz da marca.
// ---------------------------------------------------------------------------

/**
 * Preenche o cadastro do cliente com o que ele respondeu. Por padrão só mexe em
 * campo VAZIO: o que a equipe digitou à mão continua valendo.
 */
export function aplicaCadastro(clientId, secoes, respostas, { sobrescrever = false } = {}) {
  const doCadastro = respostasParaCliente(secoes, respostas);
  const linha = db.prepare("SELECT * FROM clients WHERE id = ?").get(clientId);
  if (!linha) return [];
  const mudou = [];
  for (const [col, valor] of Object.entries(doCadastro)) {
    const jaTinha = linha[col];
    const regra = CAMPOS_CLIENTE[col];
    // Coluna com valor padrão (rep_doc_type nasce 'cpf') conta como vazia:
    // senão o padrão venceria a resposta do cliente.
    const vazio = regra?.contaComoVazio
      ? regra.contaComoVazio(jaTinha)
      : (jaTinha === null || jaTinha === "" || jaTinha === undefined);
    if (!vazio && !sobrescrever) continue;
    if (String(jaTinha ?? "") === String(valor)) continue;
    db.prepare(`UPDATE clients SET ${col} = ? WHERE id = ?`).run(valor, clientId);
    mudou.push(col);
  }
  return mudou;
}

/**
 * Manda para a Central o que é acesso/senha. A senha SAI da resposta do
 * briefing: não pode ficar em texto puro à vista de quem abrir o formulário.
 * Devolve { titulos, respostas } — as respostas já com a troca feita.
 */
export function aplicaCentral(orgId, clientId, secoes, respostas) {
  const paraCentral = respostasParaCentral(secoes, respostas);
  const titulos = [];
  const novas = { ...respostas };
  let mexeu = false;
  for (const item of paraCentral) {
    guardaNaCentral(orgId, clientId, item);
    titulos.push(item.title);
    if (item.kind === "credential") { novas[item.pergunta] = "(guardado na Central)"; mexeu = true; }
  }
  return { titulos, respostas: novas, mexeu };
}

/**
 * O contrato do onboarding. Só gera se a agência tiver definido os termos e se
 * ainda não houver um contrato esperando assinatura para este cliente — clicar
 * duas vezes, ou o cliente reenviar, não pode virar dois contratos.
 */
export function geraContratoDoOnboarding(briefing) {
  let termos = null;
  try { termos = briefing.terms ? JSON.parse(briefing.terms) : null; } catch { termos = null; }
  if (!termos || (!termos.service_id && !termos.template_id)) return null;

  const jaTem = db.prepare(
    "SELECT id FROM contracts WHERE client_id = ? AND org_id = ? AND signed_at IS NULL ORDER BY id DESC LIMIT 1"
  ).get(briefing.client_id, briefing.org_id);
  if (jaTem) return null;

  return geraContrato(briefing.org_id, { ...termos, client_id: briefing.client_id });
}

/** Tudo de uma vez, quando o cliente aperta "enviar". */
export function fechaOnboarding(briefing, respostas) {
  const secoes = getTemplate(briefing.org_id).secoes;
  const cadastro = aplicaCadastro(briefing.client_id, secoes, respostas);
  const central = aplicaCentral(briefing.org_id, briefing.client_id, secoes, respostas);
  if (central.mexeu) {
    db.prepare("UPDATE briefings SET answers = ? WHERE id = ?").run(JSON.stringify(central.respostas), briefing.id);
  }
  // O contrato vem DEPOIS do cadastro de propósito: é o cadastro que acabou de
  // ganhar a razão social, o CNPJ e quem assina.
  let contrato = null;
  let erroContrato = null;
  try {
    contrato = geraContratoDoOnboarding(briefing);
  } catch (e) {
    // Faltando o modelo, o briefing NÃO pode falhar: o cliente já respondeu
    // tudo. A agência resolve o contrato depois, avisada.
    erroContrato = e.message;
  }
  return { cadastro, central: central.titulos, contrato, erroContrato };
}
