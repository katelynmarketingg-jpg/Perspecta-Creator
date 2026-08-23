// Catálogo de datas comemorativas/sazonais do Brasil para social media e
// marketing, no espírito do datascomemorativas.me: o mais completo possível e
// com CADA data separada — se várias caem no mesmo dia, cada uma é um item
// próprio, para selecionar individualmente. Datas fixas + móveis por ano.
// Para ampliar: é só acrescentar uma linha em FIXAS ([mês, dia, nome, categoria]).

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Domingo/segunda... = 0..6. n-ésima ocorrência de um dia da semana no mês.
function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month - 1, 1).getDay();
  const day = 1 + ((7 + weekday - first) % 7) + (n - 1) * 7;
  return new Date(year, month - 1, day);
}
function lastWeekday(year, month, weekday) {
  const last = new Date(year, month, 0); // último dia do mês
  const back = (7 + last.getDay() - weekday) % 7;
  return new Date(year, month - 1, last.getDate() - back);
}
// Páscoa (algoritmo de Gauss/Anonymous Gregorian).
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
const addDays = (dt, n) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);
const dISO = (dt) => iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());

// Datas fixas: [mês, dia, nome, categoria]
// categorias: feriado | comercial | comemorativa | sazonal | saude
const FIXAS = [
  // ===== JANEIRO =====
  [1, 1, "Confraternização Universal (Ano Novo)", "feriado"],
  [1, 1, "Dia Mundial da Paz", "comemorativa"],
  [1, 2, "Dia da Abreugrafia", "comemorativa"],
  [1, 6, "Dia de Reis", "comemorativa"],
  [1, 6, "Dia da Gratidão", "comemorativa"],
  [1, 8, "Dia do Fotógrafo", "comemorativa"],
  [1, 9, "Dia do Fico", "comemorativa"],
  [1, 9, "Dia do Astronauta", "comemorativa"],
  [1, 12, "Dia Mundial da Marmita", "comercial"],
  [1, 15, "Dia do Adestrador", "comemorativa"],
  [1, 20, "Dia do Farmacêutico", "comemorativa"],
  [1, 24, "Dia da Previdência Social", "comemorativa"],
  [1, 24, "Dia da Constituição", "comemorativa"],
  [1, 25, "Aniversário de São Paulo", "comemorativa"],
  [1, 27, "Dia Internacional em Memória do Holocausto", "comemorativa"],
  [1, 28, "Dia Mundial da Privacidade de Dados", "comemorativa"],
  [1, 30, "Dia da Saudade", "comemorativa"],
  [1, 30, "Dia da Não Violência e da Paz", "comemorativa"],
  [1, 31, "Dia do Mágico", "comemorativa"],

  // ===== FEVEREIRO =====
  [2, 2, "Dia de Iemanjá", "comemorativa"],
  [2, 2, "Dia de Nossa Senhora dos Navegantes", "comemorativa"],
  [2, 4, "Dia Mundial do Câncer", "saude"],
  [2, 9, "Dia da Internet Segura", "comemorativa"],
  [2, 9, "Dia da Pizza (internacional)", "comercial"],
  [2, 13, "Dia Mundial do Rádio", "comemorativa"],
  [2, 14, "Dia dos Namorados (Valentine's — internacional)", "comercial"],
  [2, 15, "Dia do Repórter Fotográfico", "comemorativa"],
  [2, 17, "Dia do Gari", "comemorativa"],
  [2, 19, "Dia do Esportista", "comemorativa"],
  [2, 21, "Dia Internacional da Língua Materna", "comemorativa"],
  [2, 27, "Dia Nacional do Livro Didático", "comemorativa"],
  [2, 28, "Dia Mundial das Doenças Raras", "saude"],

  // ===== MARÇO =====
  [3, 1, "Dia Nacional do Turismo Ecológico", "comemorativa"],
  [3, 4, "Dia Mundial da Obesidade", "saude"],
  [3, 5, "Dia do Salgadinho", "comercial"],
  [3, 8, "Dia Internacional da Mulher", "comemorativa"],
  [3, 10, "Dia do Telefone", "comemorativa"],
  [3, 12, "Dia do Bibliotecário", "comemorativa"],
  [3, 14, "Dia Nacional dos Animais", "comemorativa"],
  [3, 15, "Dia Mundial do Consumidor", "comercial"],
  [3, 18, "Dia da Poesia", "comemorativa"],
  [3, 19, "Dia de São José", "comemorativa"],
  [3, 19, "Dia do Carpinteiro", "comemorativa"],
  [3, 20, "Início do Outono", "sazonal"],
  [3, 20, "Dia Internacional da Felicidade", "comemorativa"],
  [3, 21, "Dia Internacional contra a Discriminação Racial", "comemorativa"],
  [3, 21, "Dia Mundial da Síndrome de Down", "saude"],
  [3, 21, "Dia da Árvore (florestas)", "comemorativa"],
  [3, 22, "Dia Mundial da Água", "comemorativa"],
  [3, 23, "Dia Mundial da Meteorologia", "comemorativa"],
  [3, 24, "Dia Nacional do Riso", "comemorativa"],
  [3, 25, "Dia do Especialista de Contas", "comemorativa"],
  [3, 27, "Dia Mundial do Teatro", "comemorativa"],
  [3, 27, "Dia do Circo", "comemorativa"],
  [3, 28, "Dia do Diagramador", "comemorativa"],
  [3, 29, "Dia do Corretor de Imóveis", "comemorativa"],
  [3, 30, "Dia Mundial do Transtorno Bipolar", "saude"],
  [3, 31, "Dia da Saúde e Nutrição", "saude"],

  // ===== ABRIL =====
  [4, 1, "Dia da Mentira", "comemorativa"],
  [4, 2, "Dia Mundial da Conscientização do Autismo", "saude"],
  [4, 2, "Dia Internacional do Livro Infantil", "comemorativa"],
  [4, 4, "Dia do Jornalismo Esportivo", "comemorativa"],
  [4, 6, "Dia Mundial da Atividade Física", "saude"],
  [4, 7, "Dia Mundial da Saúde", "saude"],
  [4, 7, "Dia do Jornalista", "comemorativa"],
  [4, 8, "Dia Nacional de Combate ao Câncer", "saude"],
  [4, 11, "Dia do Doente de Parkinson", "saude"],
  [4, 13, "Dia do Beijo", "comemorativa"],
  [4, 13, "Dia do Hino Nacional", "comemorativa"],
  [4, 14, "Dia Pan-Americano", "comemorativa"],
  [4, 15, "Dia Mundial da Arte", "comemorativa"],
  [4, 15, "Dia do Desenhista", "comemorativa"],
  [4, 18, "Dia Nacional do Livro Infantil", "comemorativa"],
  [4, 19, "Dia dos Povos Indígenas", "comemorativa"],
  [4, 20, "Dia do Diplomata", "comemorativa"],
  [4, 21, "Tiradentes", "feriado"],
  [4, 22, "Descobrimento do Brasil", "comemorativa"],
  [4, 22, "Dia Mundial da Terra", "comemorativa"],
  [4, 23, "Dia Mundial do Livro", "comemorativa"],
  [4, 25, "Dia do Contabilista", "comemorativa"],
  [4, 26, "Dia Nacional de Prevenção contra a Hipertensão", "saude"],
  [4, 27, "Dia da Empregada Doméstica", "comemorativa"],
  [4, 28, "Dia da Educação", "comemorativa"],
  [4, 28, "Dia da Sogra", "comemorativa"],
  [4, 30, "Dia Nacional da Mulher", "comemorativa"],

  // ===== MAIO =====
  [5, 1, "Dia do Trabalho", "feriado"],
  [5, 3, "Dia Mundial da Liberdade de Imprensa", "comemorativa"],
  [5, 4, "Dia do Combatente", "comemorativa"],
  [5, 4, "Star Wars Day", "comemorativa"],
  [5, 5, "Dia das Mães (data comercial de campanha)", "comercial"],
  [5, 8, "Dia da Vitória (fim da 2ª Guerra)", "comemorativa"],
  [5, 10, "Dia da Fibromialgia", "saude"],
  [5, 12, "Dia Internacional da Enfermagem", "comemorativa"],
  [5, 13, "Abolição da Escravatura", "comemorativa"],
  [5, 15, "Dia Internacional da Família", "comemorativa"],
  [5, 15, "Dia do Assistente Social", "comemorativa"],
  [5, 17, "Dia Mundial da Internet", "comemorativa"],
  [5, 17, "Dia Internacional contra a Homofobia", "comemorativa"],
  [5, 18, "Dia Nacional de Combate ao Abuso e à Exploração de Crianças", "comemorativa"],
  [5, 20, "Dia do Pedagogo", "comemorativa"],
  [5, 22, "Dia do Abraço", "comemorativa"],
  [5, 25, "Dia do Orgulho Nerd", "comemorativa"],
  [5, 25, "Dia da Toalha", "comemorativa"],
  [5, 25, "Dia da Indústria", "comemorativa"],
  [5, 27, "Dia do Profissional Liberal", "comemorativa"],
  [5, 28, "Dia do Hambúrguer", "comercial"],
  [5, 29, "Dia do Estatuto da Terra", "comemorativa"],
  [5, 31, "Dia Mundial sem Tabaco", "saude"],

  // ===== JUNHO =====
  [6, 3, "Dia Mundial da Bicicleta", "comemorativa"],
  [6, 5, "Dia Mundial do Meio Ambiente", "comemorativa"],
  [6, 8, "Dia Mundial dos Oceanos", "comemorativa"],
  [6, 12, "Dia dos Namorados", "comercial"],
  [6, 12, "Dia Mundial contra o Trabalho Infantil", "comemorativa"],
  [6, 13, "Dia de Santo Antônio (santo casamenteiro)", "comemorativa"],
  [6, 14, "Dia Mundial do Doador de Sangue", "saude"],
  [6, 18, "Dia do Orgulho Autista", "saude"],
  [6, 20, "Dia do Refugiado", "comemorativa"],
  [6, 21, "Início do Inverno", "sazonal"],
  [6, 24, "São João (Festas Juninas)", "sazonal"],
  [6, 26, "Dia Internacional contra as Drogas", "saude"],
  [6, 28, "Dia do Orgulho LGBTQIA+", "comemorativa"],
  [6, 29, "São Pedro e São Paulo (festas juninas)", "sazonal"],

  // ===== JULHO =====
  [7, 2, "Dia do Bombeiro Brasileiro", "comemorativa"],
  [7, 4, "Dia da Independência dos EUA", "comemorativa"],
  [7, 8, "Dia do Panificador", "comercial"],
  [7, 8, "Dia Nacional da Ciência", "comemorativa"],
  [7, 10, "Dia da Pizza", "comercial"],
  [7, 11, "Dia Mundial da População", "comemorativa"],
  [7, 12, "Dia do Engenheiro Florestal", "comemorativa"],
  [7, 13, "Dia Mundial do Rock", "comemorativa"],
  [7, 14, "Dia do Propagandista", "comemorativa"],
  [7, 16, "Dia do Comerciante", "comercial"],
  [7, 20, "Dia do Amigo", "comemorativa"],
  [7, 20, "Dia Internacional da Amizade", "comemorativa"],
  [7, 23, "Dia do Guarda Rodoviário", "comemorativa"],
  [7, 25, "Dia do Escritor", "comemorativa"],
  [7, 25, "Dia do Motorista", "comemorativa"],
  [7, 26, "Dia dos Avós", "comercial"],
  [7, 27, "Dia do Despachante", "comemorativa"],
  [7, 28, "Dia Mundial de Combate às Hepatites Virais", "saude"],
  [7, 30, "Dia Internacional da Amizade (ONU)", "comemorativa"],

  // ===== AGOSTO =====
  [8, 1, "Dia Nacional dos Profissionais de Educação Física", "comemorativa"],
  [8, 5, "Dia Nacional da Saúde", "saude"],
  [8, 6, "Dia Nacional dos Profissionais do Livro", "comemorativa"],
  [8, 8, "Dia do Pai (data alternativa)", "comercial"],
  [8, 11, "Dia do Estudante", "comemorativa"],
  [8, 11, "Dia do Advogado", "comemorativa"],
  [8, 12, "Dia Internacional da Juventude", "comemorativa"],
  [8, 13, "Dia Mundial do Canhoto", "comemorativa"],
  [8, 15, "Dia dos Solteiros", "comemorativa"],
  [8, 15, "Dia da Informática", "comemorativa"],
  [8, 19, "Dia Mundial da Fotografia", "comemorativa"],
  [8, 22, "Dia do Folclore", "comemorativa"],
  [8, 25, "Dia do Feirante", "comemorativa"],
  [8, 25, "Dia do Soldado", "comemorativa"],
  [8, 27, "Dia do Psicólogo", "comemorativa"],
  [8, 29, "Dia Nacional de Combate ao Fumo", "saude"],
  [8, 31, "Dia da Nutricionista", "comemorativa"],

  // ===== SETEMBRO (Setembro Amarelo) =====
  [9, 1, "Setembro Amarelo — Prevenção ao Suicídio (mês)", "saude"],
  [9, 3, "Dia do Biólogo", "comemorativa"],
  [9, 5, "Dia da Amazônia", "comemorativa"],
  [9, 7, "Independência do Brasil", "feriado"],
  [9, 8, "Dia Mundial da Alfabetização", "comemorativa"],
  [9, 9, "Dia do Administrador", "comemorativa"],
  [9, 10, "Dia Mundial de Prevenção ao Suicídio", "saude"],
  [9, 12, "Dia Nacional do Cerrado", "comemorativa"],
  [9, 15, "Dia do Cliente", "comercial"],
  [9, 16, "Dia da Preservação da Camada de Ozônio", "comemorativa"],
  [9, 18, "Dia dos Símbolos Nacionais", "comemorativa"],
  [9, 21, "Dia da Árvore", "comemorativa"],
  [9, 21, "Dia Nacional de Luta da Pessoa com Deficiência", "comemorativa"],
  [9, 21, "Dia Mundial do Alzheimer", "saude"],
  [9, 22, "Início da Primavera", "sazonal"],
  [9, 23, "Dia Internacional contra a Exploração Sexual", "comemorativa"],
  [9, 27, "Dia Mundial do Turismo", "comemorativa"],
  [9, 27, "Dia do Encanador", "comemorativa"],
  [9, 29, "Dia Mundial do Coração", "saude"],
  [9, 30, "Dia da Secretária", "comemorativa"],
  [9, 30, "Dia do Tradutor", "comemorativa"],

  // ===== OUTUBRO (Outubro Rosa) =====
  [10, 1, "Outubro Rosa — Câncer de Mama (mês)", "saude"],
  [10, 1, "Dia Internacional do Idoso", "comemorativa"],
  [10, 1, "Dia do Vendedor", "comercial"],
  [10, 2, "Dia do Anjo da Guarda", "comemorativa"],
  [10, 4, "Dia Mundial dos Animais", "comemorativa"],
  [10, 4, "Dia de São Francisco de Assis", "comemorativa"],
  [10, 5, "Dia das Aves", "comemorativa"],
  [10, 5, "Dia Mundial dos Professores", "comemorativa"],
  [10, 12, "Dia das Crianças", "comercial"],
  [10, 12, "Nossa Senhora Aparecida (padroeira do Brasil)", "feriado"],
  [10, 15, "Dia do Professor", "comemorativa"],
  [10, 16, "Dia Mundial da Alimentação", "comemorativa"],
  [10, 16, "Dia do Chef de Cozinha", "comercial"],
  [10, 17, "Dia Internacional para a Erradicação da Pobreza", "comemorativa"],
  [10, 18, "Dia do Médico", "comemorativa"],
  [10, 19, "Dia do Profissional de Informática (TI)", "comemorativa"],
  [10, 20, "Dia do Arquiteto", "comemorativa"],
  [10, 21, "Dia do Contato Publicitário", "comemorativa"],
  [10, 23, "Dia do Aviador", "comemorativa"],
  [10, 24, "Dia das Nações Unidas", "comemorativa"],
  [10, 25, "Dia do Dentista", "comemorativa"],
  [10, 27, "Dia do Analista de Sistemas", "comemorativa"],
  [10, 28, "Dia do Servidor Público", "comemorativa"],
  [10, 29, "Dia Mundial do AVC", "saude"],
  [10, 29, "Dia Nacional do Livro", "comemorativa"],
  [10, 31, "Halloween (Dia das Bruxas)", "comercial"],
  [10, 31, "Dia da Poupança", "comercial"],

  // ===== NOVEMBRO (Novembro Azul) =====
  [11, 1, "Novembro Azul — Saúde do Homem (mês)", "saude"],
  [11, 2, "Finados", "feriado"],
  [11, 4, "Dia do Inventor", "comemorativa"],
  [11, 5, "Dia da Ciência e Cultura", "comemorativa"],
  [11, 5, "Dia Nacional da Língua Portuguesa", "comemorativa"],
  [11, 12, "Dia do Diretor de Escola", "comemorativa"],
  [11, 14, "Dia Mundial do Diabetes", "saude"],
  [11, 15, "Proclamação da República", "feriado"],
  [11, 16, "Dia Internacional da Tolerância", "comemorativa"],
  [11, 17, "Dia da Criatividade", "comemorativa"],
  [11, 19, "Dia da Bandeira", "comemorativa"],
  [11, 20, "Dia da Consciência Negra", "feriado"],
  [11, 21, "Dia da Homeopatia", "saude"],
  [11, 22, "Dia do Músico", "comemorativa"],
  [11, 25, "Dia Internacional pela Eliminação da Violência contra a Mulher", "comemorativa"],
  [11, 27, "Dia do Técnico de Segurança do Trabalho", "comemorativa"],
  [11, 29, "Dia do Doador Voluntário de Sangue", "saude"],

  // ===== DEZEMBRO =====
  [12, 1, "Dia Mundial de Combate à AIDS", "saude"],
  [12, 3, "Dia Internacional da Pessoa com Deficiência", "comemorativa"],
  [12, 4, "Dia do Orgulho Autista (aceitação)", "saude"],
  [12, 5, "Dia Internacional do Voluntariado", "comemorativa"],
  [12, 8, "Dia da Família", "comemorativa"],
  [12, 9, "Dia Internacional contra a Corrupção", "comemorativa"],
  [12, 10, "Dia dos Direitos Humanos", "comemorativa"],
  [12, 13, "Dia do Marinheiro", "comemorativa"],
  [12, 13, "Dia de Santa Luzia", "comemorativa"],
  [12, 15, "Dia do Jardineiro", "comemorativa"],
  [12, 17, "Dia do Pobre (São Lázaro)", "comemorativa"],
  [12, 21, "Início do Verão", "sazonal"],
  [12, 24, "Véspera de Natal", "comercial"],
  [12, 25, "Natal", "comercial"],
  [12, 26, "Dia Mundial do Boxing Day", "comercial"],
  [12, 31, "Réveillon (véspera de Ano Novo)", "comercial"],
];

// Datas móveis calculadas para o ano (cada uma separada).
function moveis(year) {
  const pascoa = easter(year);
  const maes = nthWeekday(year, 5, 0, 2);    // 2º domingo de maio
  const pais = nthWeekday(year, 8, 0, 2);     // 2º domingo de agosto
  const noivos = nthWeekday(year, 8, 0, 4);   // 4º domingo de agosto
  const black = lastWeekday(year, 11, 5);     // última sexta de novembro
  const cyber = addDays(black, 3);            // segunda seguinte
  return [
    { date: dISO(addDays(pascoa, -47)), name: "Carnaval (terça-feira)", category: "sazonal" },
    { date: dISO(addDays(pascoa, -46)), name: "Quarta-feira de Cinzas", category: "sazonal" },
    { date: dISO(addDays(pascoa, -2)), name: "Sexta-feira Santa (Paixão de Cristo)", category: "feriado" },
    { date: dISO(pascoa), name: "Páscoa", category: "comercial" },
    { date: dISO(addDays(pascoa, 60)), name: "Corpus Christi", category: "feriado" },
    { date: dISO(maes), name: "Dia das Mães", category: "comercial" },
    { date: dISO(pais), name: "Dia dos Pais", category: "comercial" },
    { date: dISO(noivos), name: "Dia dos Noivos", category: "comercial" },
    { date: dISO(black), name: "Black Friday", category: "comercial" },
    { date: dISO(cyber), name: "Cyber Monday", category: "comercial" },
  ];
}

// Todas as datas do ano, ordenadas (mantendo cada item separado).
export function seasonalFor(year) {
  const fixas = FIXAS.map(([m, d, name, category]) => ({ date: iso(year, m, d), name, category }));
  return [...fixas, ...moveis(year)].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export const CATEGORY_COLOR = {
  comercial: "primary",
  feriado: "error",
  comemorativa: "secondary",
  sazonal: "success",
  saude: "warning",
};

// Cor "crua" (hex) por categoria — para pintar as datas no calendário.
export const CATEGORY_HEX = {
  comercial: "#2563EB",
  feriado: "#DC2626",
  comemorativa: "#7C3AED",
  sazonal: "#16A34A",
  saude: "#D97706",
};
