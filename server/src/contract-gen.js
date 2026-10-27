import { db } from "./db.js";
import { valorPorExtenso, formataDocumento, dataExtenso, dataCurta } from "./receipts.js";
import { CAMPOS_CLIENTE } from "./briefing.js";

// ---------------------------------------------------------------------------
// OS DADOS DO CLIENTE QUE UM CONTRATO PEDE — lidos dos {{marcadores}}.
//
// Pedido dela: "cada vez que eu crio um {{}} no contrato, cria lá (no briefing)
// automático, só pra eu renomear a pergunta". Para isso, cada marcador que fala
// de um dado DO CLIENTE aponta para a coluna do cadastro dele; o briefing então
// nasce com uma pergunta por dado, já ligada ao cadastro, e ela só renomeia.
//
// Marcador de agência ({{agencia}}, {{cnpj_agencia}}…), de valor/prazo
// ({{valor}}, {{data}}, {{duracao}}…) e de assinatura NÃO entram: esses saem
// das Configurações e dos termos que a agência preenche, não de uma pergunta.
// ---------------------------------------------------------------------------
export const MARCADOR_PARA_CAMPO = {
  cliente: "name",
  empresa: "company",
  razao_social: "legal_name",
  cnpj: "document", documento: "document", cnpj_formatado: "document", cnpj_numeros: "document",
  endereco: "address",
  representante: "rep_name",
  documento_representante: "rep_document",
  email: "email",
  telefone: "phone",
  dia_pagamento: "payment_day",
  segmento: "segment",
};

// O tipo de pergunta que melhor casa com cada campo (o resto é "texto").
const TIPO_SUGERIDO = { document: "cnpj", payment_day: "dia" };

/**
 * Os campos do cadastro que um contrato pede, lidos dos {{marcadores}} do texto.
 * Devolve [{ campo, rotulo, tipo }] SEM repetir, na ordem em que aparecem.
 */
export function camposClienteDoContrato(body) {
  const vistos = new Set();
  const saida = [];
  const re = /\{\{\s*([\wçãáéíóú]+)\s*\}\}/gi;
  let m;
  while ((m = re.exec(String(body || "")))) {
    const campo = MARCADOR_PARA_CAMPO[m[1].toLowerCase()];
    if (!campo || vistos.has(campo) || !CAMPOS_CLIENTE[campo]) continue;
    vistos.add(campo);
    saida.push({ campo, rotulo: CAMPOS_CLIENTE[campo].rotulo, tipo: TIPO_SUGERIDO[campo] || "texto" });
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Gerar o contrato a partir de um modelo.
//
// Vive fora da rota porque o briefing também gera: quando o cliente termina de
// responder, o contrato já nasce pronto para assinar, com os dados dele (do
// cadastro, que o briefing preencheu) e os termos comerciais que a agência
// definiu ao mandar o link.
// ---------------------------------------------------------------------------

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function hoje() {
  const d = new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export function brl(v) {
  // Com separador de milhar: num contrato, "R$ 1500,00" fica amador ao lado de
  // "R$ 1.500,00" — e valores maiores ficam difíceis de ler.
  return `R$ ${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Troca {{marcador}} pelos valores. Marcador desconhecido fica como está. */
export function preencher(body, map) {
  return String(body || "").replace(/\{\{\s*([\wçãáéíóú]+)\s*\}\}/gi, (_, k) => {
    const key = k.toLowerCase();
    return map[key] !== undefined && map[key] !== null ? String(map[key]) : `{{${k}}}`;
  });
}

/** "Posts por mês" -> "posts_por_mes", para virar o marcador {{qtd_posts_por_mes}}. */
function slug(texto) {
  return String(texto || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/**
 * A frase inteira concordando com o número. "02 (duas) captação presencial"
 * está errado: o número concordava e o resto da frase não. Aqui sai
 * "02 (duas) captações presenciais" — e no singular, "01 (uma) captação
 * presencial".
 */
function frase(n, { um, muitos, genero = "m" }) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  return `${quantia(v, genero)} ${v === 1 ? um : muitos}`;
}

/** O verbo que acompanha: "será realizada" x "serão realizadas". */
function verbo(n, { um, muitos }) {
  const v = Number(n);
  return (!Number.isFinite(v) || v === 1) ? um : muitos;
}

/** A quantidade da entrega cujo nome casa com o padrão ("Posts por mês" ~ /post/). */
function porNome(itens, padrao) {
  if (!Array.isArray(itens)) return undefined;
  const achado = itens.find((i) => padrao.test(slug(i.label)));
  return achado ? achado.quantidade : undefined;
}

/**
 * "04 (quatro)" — como se escreve quantidade em contrato.
 *
 * O número por extenso vem de valorPorExtenso, que escreve DINHEIRO ("um
 * real", "quatro reais"). Tirar só " reais" funcionava no plural e falhava no
 * singular: o contrato dela saiu com "01 (UM REAL) captação presencial ao mês".
 * Aqui a moeda é removida nos dois casos.
 *
 * E português tem gênero no 1 e no 2: é "01 (uma) captação" e "02 (duas)
 * captações", mas "01 (um) post". Por isso o `genero`.
 */
/**
 * Número escrito do jeito de quem fala português: "1.500,50" e "1500,50" são
 * mil e quinhentos e cinquenta centavos, não lixo.
 *
 * Era um buraco calado e caro: Number("1500,50") não é número, e o contrato
 * saía com "R$ 0,00 (zero real)" — contrato de valor ZERO, sem um aviso
 * sequer, só porque a pessoa digitou a vírgula que se usa no Brasil.
 */
export function numeroBR(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let t = String(v ?? "").trim().replace(/\s|R\$/gi, "");
  if (!t) return 0;
  // "1.500,50" (ponto de milhar + vírgula decimal) -> "1500.50"
  if (/,/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** Quantidade de entrega é coisa inteira: não existe 2,7 posts por mês. */
function inteiro(v) {
  const n = numeroBR(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function quantia(n, genero = "m") {
  // Arredonda de propósito: o número e o extenso saíam brigando dentro do mesmo
  // parêntese — "2.7 (dois) posts" — e é a primeira coisa que um advogado pega.
  const v = inteiro(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  let extenso = valorPorExtenso(v).replace(/\s+(reais|real)\b.*/i, "").trim();
  if (genero === "f") {
    extenso = extenso.replace(/\bum\b$/, "uma").replace(/\bdois\b$/, "duas");
  }
  return `${String(v).padStart(2, "0")} (${extenso})`;
}

/**
 * Decompõe a vigência em MESES CHEIOS + DIAS que sobram, dia a dia.
 *   16/10 → 16/11 = { meses: 1, dias: 0 }
 *   16/10 → 21/11 = { meses: 1, dias: 5 }
 *   16/10 → 10/11 = { meses: 0, dias: 25 }
 */
export function partesVigencia(inicio, fim) {
  if (!inicio || !fim) return { meses: null, dias: 0 };
  const a = new Date(`${inicio}T12:00:00`);
  const b = new Date(`${fim}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return { meses: null, dias: 0 };
  let meses = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) meses -= 1;   // o último mês ainda não fechou
  if (meses < 0) meses = 0;
  const anchor = new Date(a.getFullYear(), a.getMonth() + meses, a.getDate(), 12, 0, 0);
  let dias = Math.round((b - anchor) / 86400000);
  if (dias < 0) dias = 0;
  return { meses, dias };
}

/** Texto da vigência: "1 mês", "2 meses", "1 mês e 5 dias", "25 dias". */
export function textoVigencia(meses, dias, { extenso = false } = {}) {
  const n = (v) => (extenso ? quantia(v) : String(v));
  const partes = [];
  if (meses) partes.push(`${n(meses)} ${meses === 1 ? "mês" : "meses"}`);
  if (dias) partes.push(`${n(dias)} ${dias === 1 ? "dia" : "dias"}`);
  if (!partes.length) return "prazo indeterminado";
  return partes.join(" e ");
}

/** Meses cheios da vigência (inteiro), para a coluna duration_months. */
export function mesesDeVigencia(inicio, fim) {
  const { meses } = partesVigencia(inicio, fim);
  return meses;
}

/**
 * Monta o contrato e grava. `termos` é o que a AGÊNCIA define (valor, serviço,
 * quantidades, vigência e a data que deve constar); o resto vem do cadastro.
 */
/**
 * O texto-base do contrato. Vive em DOIS lugares, porque a casa escreve nos
 * dois: em Serviços (cada serviço tem o seu contrato) e em Modelos de contrato.
 * Aqui os dois valem — senão a pessoa escreve num lugar e o sistema procura no
 * outro, e o contrato nunca aparece.
 */
export function achaModelo(orgId, termos = {}) {
  if (termos.service_id) {
    const svc = db.prepare("SELECT id, name, contract_template, contract_style FROM services WHERE id = ? AND org_id = ?")
      .get(termos.service_id, orgId);
    if (svc && String(svc.contract_template || "").trim()) {
      // O estilo vem junto: é ele que leva o logo para o contrato de verdade.
      return { name: svc.name, body: svc.contract_template, estilo: svc.contract_style || null,
               origem: "servico", id: svc.id };
    }
    // O serviço existe mas está sem contrato escrito: dizer isso é mais útil do
    // que "modelo não encontrado".
    if (svc) { const e = new Error(`O serviço "${svc.name}" ainda não tem contrato escrito. Abra Serviços e escreva o modelo dele.`); e.code = "MODELO_VAZIO"; throw e; }
  }
  if (termos.template_id) {
    const tpl = db.prepare("SELECT id, name, body FROM contract_templates WHERE id = ? AND org_id = ?")
      .get(termos.template_id, orgId);
    if (tpl) return { ...tpl, origem: "modelo" };
  }
  const e = new Error("Modelo não encontrado."); e.code = "SEM_MODELO"; throw e;
}

/** Todos os modelos que a casa pode usar, dos dois lugares, numa lista só. */
export function modelosDisponiveis(orgId) {
  const servicos = db.prepare("SELECT id, name, contract_template, default_price, items_schema FROM services WHERE org_id = ? ORDER BY name").all(orgId);
  const modelos = db.prepare("SELECT id, name, body FROM contract_templates WHERE org_id = ? ORDER BY name").all(orgId);
  return [
    ...servicos.map((s) => ({
      origem: "servico", id: s.id, name: s.name,
      tem_contrato: Boolean(String(s.contract_template || "").trim()),
      valor_padrao: s.default_price || 0,
      itens: s.items_schema ? JSON.parse(s.items_schema) : [],
      // Os dados do cliente que ESTE contrato pede — é o que deixa o briefing
      // nascer com uma pergunta para cada marcador.
      campos_contrato: camposClienteDoContrato(s.contract_template),
    })),
    ...modelos.map((m) => ({
      origem: "modelo", id: m.id, name: m.name,
      tem_contrato: Boolean(String(m.body || "").trim()), valor_padrao: 0, itens: [],
      campos_contrato: camposClienteDoContrato(m.body),
    })),
  ];
}

// Um dado que faltou vira uma LINHA para preencher à mão, e não um buraco.
// "inscrita no CNPJ sob o n.º ," é defeito; "sob o n.º ______" é um contrato
// esperando um dado, que é o que ele de fato é.
const LINHA = "_______________";

/**
 * O contrato não pode sair furado sem ninguém saber. Aqui cada campo essencial
 * é conferido: o que estiver vazio entra na lista `faltando`, que sobe até a
 * tela — antes o contrato saía com "sob o n.º ," e só um advogado ia notar.
 */
/**
 * Termos que a agência preencheu de um jeito que o contrato não consegue honrar
 * — e que, calados, viram contrato errado assinado.
 */
function confereTermos(termos = {}) {
  const avisos = [];
  const { start_date: ini, end_date: fim } = termos;
  // Fim antes do início: a vigência não fecha e o contrato saía com "prazo
  // indeterminado", sem uma palavra — um contrato mensal virava sem prazo.
  if (ini && fim && new Date(`${fim}T12:00:00`) < new Date(`${ini}T12:00:00`)) {
    avisos.push("vigência invertida (a data de fim é anterior à de início)");
  }
  if (numeroBR(termos.value) <= 0) avisos.push("valor mensal");
  for (const i of (Array.isArray(termos.itens) ? termos.itens : [])) {
    if (numeroBR(i?.quantidade) < 0) avisos.push(`quantidade negativa em "${i.label}"`);
  }
  return avisos;
}

function confereEssenciais(client, org = {}) {
  const essenciais = [
    ["razão social", client.legal_name || client.company || client.name],
    ["CNPJ/CPF", client.document],
    ["endereço", client.address],
    ["quem assina", client.rep_name],
    ["documento de quem assina", client.rep_document],
    ["dia do pagamento", client.payment_day],
    // Os dados da PRÓPRIA CASA também. Antes só o cliente era conferido, e o
    // contrato saía com a qualificação da agência em branco — "inscrita no CNPJ
    // sob o n.º , com sede em , representada por sua titular, ," — sem que
    // ninguém fosse avisado. Preenche em Configurações.
    ["CNPJ da agência", org.document],
    ["endereço da agência", org.address],
    ["quem assina pela agência", org.signer_name],
    ["documento de quem assina pela agência", org.signer_document],
    ["cidade da agência (para o foro)", org.city],
  ];
  return essenciais.filter(([, v]) => !String(v ?? "").trim()).map(([nome]) => nome);
}

/**
 * "no CPF", "no CNPJ", "na OAB" — o artigo TEM que concordar com o documento.
 * O contrato saía "inscrito(a) na CPF sob o n.º ...", porque o modelo trazia o
 * "na" fixo (que só serve para OAB) e o marcador só devolvia a sigla. Erro de
 * português num documento que um advogado vai ler.
 */
function documentoComArtigo(tipo) {
  const t = String(tipo || "cpf").trim().toUpperCase();
  return t === "OAB" ? "na OAB" : `no ${t}`;
}

/** CPF tem 11 dígitos; CNPJ tem 14. O contrato precisa chamar pelo nome certo. */
function rotuloDoDocumento(doc) {
  const n = String(doc || "").replace(/\D/g, "");
  if (n.length === 11) return "CPF";
  if (n.length === 14) return "CNPJ";
  return "CNPJ/CPF";
}

export function geraContrato(orgId, termos = {}) {
  const tpl = achaModelo(orgId, termos);

  const client = db.prepare("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(termos.client_id, orgId);
  if (!client) { const e = new Error("Cliente não encontrado."); e.code = "SEM_CLIENTE"; throw e; }

  const org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId) || {};
  const valor = numeroBR(termos.value);
  // Vigência em meses + dias. Com data de início E fim, conta dia a dia (mostra
  // os dias que sobram do mês cheio). Se a agência informou duration_months
  // direto (sem datas), usa esse número redondo.
  const vig = (termos.start_date && termos.end_date)
    ? partesVigencia(termos.start_date, termos.end_date)
    : { meses: termos.duration_months ? Number(termos.duration_months) : null, dias: 0 };
  const duracao = vig.meses;                       // inteiro p/ a coluna duration_months
  const vigTexto = textoVigencia(vig.meses, vig.dias);              // "1 mês e 5 dias"
  const vigExtenso = textoVigencia(vig.meses, vig.dias, { extenso: true }); // "um mês e cinco dias"
  const diaPgto = client.payment_day ? Number(client.payment_day) : null;

  // As três entregas que o contrato da casa cita pelo nome. Saem das entregas
  // que a agência cadastrou, não importa como ela escreveu o rótulo.
  const qtPosts = porNome(termos.itens, /post/) ?? termos.posts_per_month;
  const qtVideos = porNome(termos.itens, /video|reel/) ?? termos.videos_per_month;
  const qtCaptacoes = porNome(termos.itens, /captac|gravac/) ?? termos.captures_per_month ?? 1;

  const map = {
    cliente: client.name || "",
    empresa: client.company || "",
    email: client.email || "",
    telefone: client.phone || "",
    segmento: client.segment || "",
    endereco: client.address || LINHA,
    valor: brl(valor),
    valor_extenso: valorPorExtenso(valor),
    duracao: (vig.meses || vig.dias) ? vigTexto : "prazo indeterminado",
    // A data que a agência quer que conste (senão, a de hoje).
    data: termos.contract_date ? dataExtenso(termos.contract_date) : hoje(),
    servico: termos.servico || tpl.name || "",
    // --- identificação da empresa contratante ---
    razao_social: client.legal_name || client.company || client.name || LINHA,
    // FORMATADO: é este que o contrato usa ("55.514.449/0001-60"). Antes saía
    // o número cru, "55514449000160" — feio ao lado do CNPJ da agência, que já
    // vinha pontuado, e num documento que vai para um advogado ler.
    cnpj: formataDocumento(client.document || "") || LINHA,
    documento: formataDocumento(client.document || "") || LINHA,
    cnpj_formatado: formataDocumento(client.document || "") || LINHA,
    cnpj_numeros: String(client.document || "").replace(/\D/g, ""),
    // Pessoa física assina com CPF: dizer "inscrita no CNPJ" num CPF está
    // errado no documento. Use {{documento_rotulo}} no modelo.
    documento_rotulo: rotuloDoDocumento(client.document),
    // --- quem assina pela empresa ---
    representante: client.rep_name || LINHA,
    // Também formatado: um CPF de quem assina saía "04009664096" no contrato.
    documento_representante: (formataDocumento(client.rep_document || "") || client.rep_document || LINHA),
    tipo_documento_representante: (client.rep_doc_type || "cpf").toUpperCase(),
    // Este já vem com o artigo certo ("no CPF", "na OAB"): use ESTE no modelo,
    // sem escrever "na" antes. O de cima fica para quem já tinha modelo pronto.
    documento_representante_rotulo: documentoComArtigo(client.rep_doc_type),
    // --- cobrança ---
    dia_pagamento: diaPgto ? String(diaPgto) : LINHA,
    vencimento: diaPgto ? `todo dia ${diaPgto} de cada mês` : "conforme combinado",
    // --- a agência (contratada) ---
    agencia: org.name || "",
    cnpj_agencia: formataDocumento(org.document || "") || LINHA,
    endereco_agencia: org.address || LINHA,
    representante_agencia: org.signer_name || LINHA,
    documento_representante_agencia: org.signer_document || LINHA,
    cargo_representante_agencia: org.signer_role || "",
    // --- lugar e prazos ---
    cidade: org.city || "",
    foro: org.city ? `foro da comarca de ${org.city}` : "foro da comarca da sede da CONTRATADA",
    inicio: termos.start_date ? dataExtenso(termos.start_date) : hoje(),
    inicio_curto: termos.start_date ? dataCurta(termos.start_date) : "",
    fim: termos.end_date ? dataExtenso(termos.end_date) : "prazo indeterminado",
    prazo: (vig.meses || vig.dias) ? vigExtenso : "prazo indeterminado",
    // --- o que está contratado ---
    // Os três marcadores que o contrato da casa já usa saem das entregas que a
    // agência definiu ("Posts", "Vídeos", "Captações"), não importa como ela
    // tenha escrito o nome. Assim o mesmo modelo serve para pacotes diferentes.
    posts_mes: quantia(qtPosts),
    videos_mes: quantia(qtVideos),
    captacoes_mes: quantia(qtCaptacoes, "f"),
    // As versões que já vêm com o substantivo concordando — é o que o modelo
    // da casa usa, para a frase não sair "02 (duas) captação presencial".
    posts_frase: frase(qtPosts, { um: "post estático e/ou carrossel estratégico", muitos: "posts estáticos e/ou carrosséis estratégicos" }),
    videos_frase: frase(qtVideos, { um: "vídeo no formato Reels", muitos: "vídeos no formato Reels" }),
    captacoes_frase: frase(qtCaptacoes, { um: "captação presencial", muitos: "captações presenciais", genero: "f" }),
    captacoes_verbo: verbo(qtCaptacoes, { um: "será realizada", muitos: "serão realizadas" }),
  };

  // As quantidades que a casa definiu para ESTE serviço viram marcadores pelo
  // próprio nome: "Posts por mês" pode ser escrito no contrato como
  // {{qtd_posts_por_mes}}. Assim ela cria uma entrega nova sem mexer no código.
  for (const item of Array.isArray(termos.itens) ? termos.itens : []) {
    const chave = slug(item.label);
    if (!chave) continue;
    map[`qtd_${chave}`] = quantia(item.quantidade);
    map[`qtd_${chave}_numero`] = String(Number(item.quantidade) || 0);
  }

  const corpo = preencher(tpl.body, map);
  const titulo = termos.title || `${tpl.name} — ${client.name}`;

  // Cláusula de aceite de assinatura eletrônica — é ela que dá validade entre
  // as partes à assinatura por link com código (MP 2.200-2/2001, art. 10, §2º).
  const clausulaAssinatura =
    "\n\nCLÁUSULA — ASSINATURA ELETRÔNICA. As partes concordam, para todos os fins, "
    + "em celebrar este contrato por assinatura eletrônica, nos termos do art. 10, §2º, "
    + "da MP 2.200-2/2001, reconhecendo sua plena validade e eficácia. A identidade do "
    + "signatário é confirmada por código enviado ao seu e-mail, e ficam registrados como "
    + "prova: nome, documento (CPF/CNPJ), e-mail verificado, data e hora, endereço de rede "
    + "(IP) e a verificação de integridade do documento assinado.";
  const corpoFinal = corpo + clausulaAssinatura;

  const info = db.prepare(
    `INSERT INTO contracts (client_id, title, value, duration_months, start_date, first_due_date, status, notes, style, org_id)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(client.id, titulo, valor, duracao, termos.start_date ?? null, termos.first_due_date ?? null,
        corpoFinal, tpl.estilo ?? null, orgId);

  const criado = db.prepare(
    "SELECT ct.*, c.name AS client_name FROM contracts ct LEFT JOIN clients c ON c.id = ct.client_id WHERE ct.id = ?"
  ).get(info.lastInsertRowid);
  // A lista sobe junto: é ela que faz a tela avisar "este contrato saiu sem
  // endereço e sem quem assina" em vez de deixar a agência descobrir depois.
  return { ...criado, faltando: [...confereEssenciais(client, org), ...confereTermos(termos)] };
}
