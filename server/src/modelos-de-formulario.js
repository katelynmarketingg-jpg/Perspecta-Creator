// ---------------------------------------------------------------------------
// MODELOS PRONTOS DE FORMULÁRIO.
//
// A estante de formulários nasce vazia: todo formulário novo começa igual ao
// padrão da casa, e quem quer um questionário de um ramo específico tem de
// escrever pergunta por pergunta. Estes são os prontos — o formulário inteiro,
// já com os dados do contrato na frente, para ela escolher na hora de criar.
//
// São MODELOS, não formulários: criar a partir de um faz uma cópia que vive na
// casa dela e pode ser mexida à vontade. Mudar o modelo aqui não mexe em
// formulário nenhum que já exista.
//
// Regra das perguntas (ver briefing.js):
//   · `campo_cliente` manda a resposta para o CADASTRO — é o que faz o
//     contrato sair pronto (razão social, CNPJ, quem assina, dia do pagamento).
//   · `campo` manda para a inteligência da marca (público, serviços, tom…).
//   · tipos: texto · longo · escolhas · cnpj · dia · arquivos · visual.
// ---------------------------------------------------------------------------

/** As perguntas que o CONTRATO precisa, iguais em qualquer ramo. */
const DADOS_DO_CONTRATO = {
  id: "contrato",
  titulo: "Dados para o contrato",
  intro: "A parte burocrática, de uma vez só — assim o contrato já sai pronto e a cobrança nasce certa.",
  perguntas: [
    { id: "nome_exibicao", tipo: "texto", label: "Seu nome completo", obrigatoria: true, campo_cliente: "name" },
    { id: "banca", tipo: "texto", label: "Nome do escritório / banca", campo_cliente: "company" },
    { id: "cnpj", tipo: "cnpj", label: "CNPJ (se tiver) ou CPF",
      ajuda: "Digite o CNPJ e o sistema busca o resto sozinho, na Receita Federal.",
      campo_cliente: "document" },
    { id: "razao_social", tipo: "texto", label: "Razão social", campo_cliente: "legal_name" },
    { id: "endereco", tipo: "longo", label: "Endereço completo (com CEP)", campo_cliente: "address" },
    { id: "rep_nome", tipo: "texto", label: "Quem assina o contrato", campo_cliente: "rep_name" },
    { id: "rep_tipo_doc", tipo: "escolhas", label: "Documento de quem assina",
      opcoes: ["CPF", "OAB"], campo_cliente: "rep_doc_type" },
    { id: "rep_documento", tipo: "texto", label: "Número do documento", campo_cliente: "rep_document" },
    { id: "email_contrato", tipo: "texto", label: "E-mail para o contrato e a cobrança",
      ajuda: "É para onde vai o link de assinatura — confira com calma.", obrigatoria: true,
      campo_cliente: "email" },
    { id: "telefone", tipo: "texto", label: "Telefone / WhatsApp", campo_cliente: "phone" },
    { id: "dia_pagamento", tipo: "dia", label: "Melhor dia do mês para o pagamento",
      ajuda: "É a data que vai valer no contrato e nas cobranças.",
      campo_cliente: "payment_day", dia_min: 1, dia_max: 28 },
  ],
};

/**
 * ADVOCACIA CRIMINAL — página e contrato.
 *
 * As perguntas são as que a Katelyn usa para montar a página de um criminalista:
 * trajetória, podcast e mídia, áreas de atuação, cliente ideal, diferenciais,
 * concorrentes, identidade visual e fotos. Os dados do contrato vêm na frente,
 * de propósito: é o que trava o início do trabalho.
 */
const ADVOCACIA_CRIMINAL = {
  id: "advocacia-criminal",
  nome: "Advocacia criminal — página e contrato",
  descricao: "Dados do contrato + trajetória, podcast, áreas, cliente ideal, diferenciais, visual e fotos.",
  servico: "Landing Page",
  welcome: {
    titulo: "Vamos montar a sua página, {cliente}.",
    paragrafos: [
      "São perguntas sobre você, sua trajetória e o tipo de caso que você quer atrair — e, "
        + "no começo, os dados do contrato, para já deixar a parte burocrática resolvida.",
      "Responda com calma e do seu jeito: o que você escrever aqui vira o texto da página. "
        + "Quanto mais você contar, menos a gente precisa adivinhar.",
      "Não precisa terminar de uma vez. O link guarda o que você já respondeu, e as fotos "
        + "podem vir depois, por ele mesmo.",
    ],
    botao: "Começar",
  },
  secoes: [
    {
      ...DADOS_DO_CONTRATO,
      perguntas: [
        ...DADOS_DO_CONTRATO.perguntas,
        { id: "whats_pagina", tipo: "texto",
          label: "Qual número de WhatsApp vamos usar na página para contato?",
          ajuda: "Pode ser diferente do seu pessoal — é o que vai aparecer no botão." },
        { id: "endereco_publico", tipo: "longo",
          label: "Podemos divulgar o endereço dos seus escritórios? Se sim, quais?",
          ajuda: "Se preferir não divulgar, é só dizer." },
      ],
    },
    {
      id: "formacao",
      titulo: "Formação e trajetória",
      intro: "É isto que dá autoridade à página — e o que o cliente procura antes de ligar.",
      perguntas: [
        { id: "formacao_academica", tipo: "longo", label: "Qual sua formação?",
          ajuda: "Conte a graduação e também pós-graduação, especialização, mestrado ou doutorado, se houver." },
        { id: "anos", tipo: "texto", label: "Há quantos anos atua na advocacia criminal?" },
        { id: "oab", tipo: "texto", label: "Qual seu número de OAB e seccional?",
          ajuda: "Ex.: OAB/RS 123.456" },
        { id: "publicacoes", tipo: "longo", label: "Tem livros, artigos ou publicações? Quais?" },
        { id: "porque", tipo: "longo", label: "Por que escolheu o Direito Criminal?",
          ajuda: "Pode responder como contaria para alguém numa conversa — é daqui que sai o texto mais forte da página.",
          campo: "positioning" },
      ],
    },
    {
      id: "podcast",
      titulo: "Podcast e mídia",
      intro: "Tudo que já existe de você na internet pode virar prova de autoridade na página.",
      perguntas: [
        { id: "podcast_nome", tipo: "texto", label: "Qual o nome do podcast? Você é apresentador, cohost ou convidado?" },
        { id: "podcast_sobre", tipo: "longo", label: "Sobre o que ele fala, com que frequência sai e onde está publicado?",
          ajuda: "Mande os links (Spotify, YouTube, etc.)." },
        { id: "podcast_destaque", tipo: "longo", label: "Tem algum episódio que você gostaria de destacar?" },
        { id: "imprensa", tipo: "longo", label: "Já deu entrevistas ou saiu na imprensa? Mande os links." },
        { id: "redes", tipo: "longo", label: "Quais suas redes sociais? Quais você usa de verdade?",
          ajuda: "Cole os links. Dizer quais você usa de verdade evita mandarmos gente para um perfil parado." },
      ],
    },
    {
      id: "areas",
      titulo: "Áreas de atuação",
      intro: "Serve para a página chamar o caso certo — e não o que você não quer pegar.",
      perguntas: [
        { id: "nao_atua", tipo: "longo", label: "Tem alguma área do Direito Criminal em que você não atua ou não quer atuar?",
          campo: "restrictions" },
        { id: "giro_rapido", tipo: "longo", label: "Quais demandas são de giro mais rápido?" },
        { id: "ticket_alto", tipo: "longo", label: "Quais são de ticket mais alto?" },
        { id: "quer_mais", tipo: "longo", label: "Que tipo de caso você quer receber mais e priorizar na página?",
          campo: "goals" },
        { id: "quem_atende", tipo: "escolhas", label: "Atende só a vítima, só o acusado, ou os dois?",
          opcoes: ["Só o acusado", "Só a vítima", "Os dois"] },
        { id: "plantao", tipo: "escolhas", label: "Faz plantão 24h para prisões em flagrante?",
          opcoes: ["Sim, 24h", "Sim, em horário estendido", "Não"] },
        { id: "onde_atende", tipo: "longo", label: "Em que cidades e estados atende? Atende online em todo o Brasil?",
          campo: "location" },
      ],
    },
    {
      id: "cliente_ideal",
      titulo: "Cliente ideal",
      intro: "Quem procura um criminalista está no pior dia da vida dele. Quanto melhor a gente souber quem é, melhor a página fala com ele.",
      perguntas: [
        { id: "quem_procura", tipo: "escolhas", label: "Quem costuma te procurar?",
          opcoes: ["O próprio investigado ou acusado", "Um familiar", "Os dois, depende do caso"],
          campo: "audience" },
        { id: "quando_procura", tipo: "longo", label: "Tem algum momento ou situação em que os clientes te procuram mais?",
          ajuda: "Ex.: logo depois da prisão, quando chega a intimação, antes do julgamento." },
        { id: "como_chegam", tipo: "longo", label: "Como os clientes chegam até você hoje?",
          ajuda: "Indicação, Instagram, Google, outro advogado…" },
        { id: "perguntas_frequentes", tipo: "longo", label: "Que perguntas os clientes mais fazem no primeiro contato?",
          ajuda: "Estas viram as respostas da página — é o que tira a dúvida antes de ligar." },
        { id: "desistem", tipo: "longo", label: "O que faz alguém desistir de te contratar?" },
        { id: "nao_quer", tipo: "longo", label: "Tem algum perfil de cliente que você não quer atender?" },
      ],
    },
    {
      id: "diferenciais",
      titulo: "Diferenciais",
      intro: "O que faz escolherem você e não o escritório do lado.",
      perguntas: [
        { id: "quais_diferenciais", tipo: "longo", label: "Quais você considera seus principais diferenciais?",
          campo: "differentials" },
        { id: "tres_palavras", tipo: "texto", label: "Que 3 palavras você quer que as pessoas associem ao seu nome?",
          campo: "personality" },
        { id: "so_voce", tipo: "longo", label: "Tem algo que você faz que a maioria dos colegas não faz?" },
      ],
    },
    {
      id: "concorrentes",
      titulo: "Concorrentes e referências",
      intro: "Olhar o que já existe evita fazer uma página igual à de todo mundo.",
      perguntas: [
        { id: "quem_concorre", tipo: "longo", label: "Quem são seus concorrentes diretos?",
          ajuda: "Mande nomes, sites ou Instagram." },
        { id: "concorrentes_bem", tipo: "longo", label: "O que você acha que eles fazem bem? E o que fazem mal?" },
        { id: "admira", tipo: "longo", label: "Quais profissionais você admira, de qualquer área, e por quê?" },
      ],
    },
    {
      id: "visual",
      titulo: "Identidade visual",
      intro: "Para a página ter a sua cara desde o primeiro rascunho.",
      perguntas: [
        { id: "estilo", tipo: "escolhas", label: "Você se identifica mais com um estilo moderno ou clássico?",
          opcoes: ["Moderno", "Clássico", "Um meio-termo"] },
        { id: "cores", tipo: "longo", label: "Além de preto e azul, tem outras cores que você gosta? E alguma que não quer?" },
      ],
    },
    {
      id: "fotos",
      titulo: "Fotos",
      intro: "Foto boa é metade da página. Se não tiver agora, pode mandar depois por este mesmo link.",
      perguntas: [
        { id: "tem_fotos", tipo: "escolhas", label: "Tem fotos profissionais recentes?",
          opcoes: ["Tenho e vou mandar aqui", "Tenho, mando depois", "Não tenho — preciso fazer"] },
        { id: "envios", tipo: "arquivos", label: "Mande aqui as fotos que tiver",
          ajuda: "Suas fotos profissionais, do escritório, de palestras, do podcast. "
            + "Pode mandar todas depois, por este mesmo link — ele continua valendo." },
      ],
    },
  ],
};

export const MODELOS_PRONTOS = [ADVOCACIA_CRIMINAL];

/** O modelo pelo id, ou null. */
export const modeloPronto = (id) =>
  MODELOS_PRONTOS.find((m) => m.id === String(id || "")) || null;

/** A lista enxuta para a tela: sem as perguntas inteiras. */
export const listaDeModelos = () => MODELOS_PRONTOS.map((m) => ({
  id: m.id,
  nome: m.nome,
  descricao: m.descricao,
  servico: m.servico || null,
  secoes: m.secoes.length,
  perguntas: m.secoes.reduce((n, s) => n + s.perguntas.length, 0),
}));
