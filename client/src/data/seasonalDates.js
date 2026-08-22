// Catálogo de datas comemorativas/sazonais do Brasil para social media e
// marketing. Datas fixas + móveis calculadas por ano. Lista curada com as datas
// mais usadas por agências — dá para ampliar à mão uma vez por ano.

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
  // ---- Janeiro ----
  [1, 1, "Confraternização Universal (Ano Novo)", "feriado"],
  [1, 4, "Dia Mundial do Braille", "comemorativa"],
  [1, 6, "Dia de Reis", "comemorativa"],
  [1, 9, "Dia do Fico", "comemorativa"],
  [1, 25, "Aniversário de São Paulo", "comemorativa"],
  [1, 27, "Dia Internacional em Memória do Holocausto", "comemorativa"],
  [1, 30, "Dia da Saudade", "comemorativa"],
  [1, 31, "Dia do Mágico", "comemorativa"],

  // ---- Fevereiro ----
  [2, 4, "Dia Mundial do Câncer", "saude"],
  [2, 9, "Dia da Internet Segura", "comemorativa"],
  [2, 14, "Dia dos Namorados (Valentine's — internacional)", "comercial"],
  [2, 21, "Dia Internacional da Língua Materna", "comemorativa"],
  [2, 28, "Dia Mundial das Doenças Raras", "saude"],

  // ---- Março ----
  [3, 1, "Fevereiro Roxo/Laranja (lúpus, fibromialgia, leucemia)", "saude"],
  [3, 8, "Dia Internacional da Mulher", "comemorativa"],
  [3, 14, "Dia do Consumidor (semana do consumidor)", "comercial"],
  [3, 15, "Dia Mundial do Consumidor", "comercial"],
  [3, 19, "Dia de São José / Dia do Carpinteiro", "comemorativa"],
  [3, 20, "Início do Outono / Dia da Felicidade", "sazonal"],
  [3, 21, "Dia Internacional contra a Discriminação Racial", "comemorativa"],
  [3, 22, "Dia Mundial da Água", "comemorativa"],
  [3, 24, "Dia Nacional do Riso", "comemorativa"],
  [3, 27, "Dia do Circo / Dia mundial do Teatro", "comemorativa"],

  // ---- Abril ----
  [4, 1, "Dia da Mentira", "comemorativa"],
  [4, 2, "Dia Mundial da Conscientização do Autismo", "saude"],
  [4, 7, "Dia Mundial da Saúde", "saude"],
  [4, 15, "Dia Mundial da Arte", "comemorativa"],
  [4, 18, "Dia Nacional do Livro Infantil", "comemorativa"],
  [4, 19, "Dia dos Povos Indígenas", "comemorativa"],
  [4, 21, "Tiradentes", "feriado"],
  [4, 22, "Descobrimento do Brasil", "comemorativa"],
  [4, 23, "Dia Mundial do Livro", "comemorativa"],
  [4, 28, "Dia da Educação", "comemorativa"],

  // ---- Maio ----
  [5, 1, "Dia do Trabalho", "feriado"],
  [5, 3, "Dia Mundial da Liberdade de Imprensa", "comemorativa"],
  [5, 4, "Dia do Combatente / Star Wars Day", "comemorativa"],
  [5, 13, "Abolição da Escravatura", "comemorativa"],
  [5, 15, "Dia Internacional da Família", "comemorativa"],
  [5, 17, "Dia Mundial da Internet / Combate à Homofobia", "comemorativa"],
  [5, 25, "Dia do Orgulho Nerd / Dia da Toalha", "comemorativa"],
  [5, 28, "Dia da Hamburguer", "comercial"],
  [5, 31, "Dia Mundial sem Tabaco (Maio Amarelo — trânsito)", "saude"],

  // ---- Junho ----
  [6, 5, "Dia Mundial do Meio Ambiente", "comemorativa"],
  [6, 12, "Dia dos Namorados", "comercial"],
  [6, 13, "Dia de Santo Antônio (casamenteiro)", "comemorativa"],
  [6, 18, "Dia do Orgulho Autista", "saude"],
  [6, 21, "Início do Inverno", "sazonal"],
  [6, 24, "São João (Festas Juninas)", "sazonal"],
  [6, 28, "Dia do Orgulho LGBTQIA+", "comemorativa"],
  [6, 29, "São Pedro (festas juninas)", "sazonal"],

  // ---- Julho ----
  [7, 2, "Dia do Bombeiro Brasileiro", "comemorativa"],
  [7, 8, "Dia do Panificador / do Pão", "comercial"],
  [7, 10, "Dia da Pizza", "comercial"],
  [7, 13, "Dia Mundial do Rock", "comemorativa"],
  [7, 20, "Dia do Amigo / Dia Internacional da Amizade", "comemorativa"],
  [7, 25, "Dia do Escritor / Dia do Motorista", "comemorativa"],
  [7, 26, "Dia dos Avós", "comercial"],
  [7, 28, "Dia Mundial das Hepatites Virais (Julho Amarelo)", "saude"],

  // ---- Agosto ----
  [8, 5, "Dia Nacional da Saúde", "saude"],
  [8, 11, "Dia do Estudante / Dia do Advogado", "comemorativa"],
  [8, 12, "Dia Internacional da Juventude", "comemorativa"],
  [8, 15, "Dia dos Solteiros / da Informática", "comemorativa"],
  [8, 22, "Dia do Folclore (Agosto Lilás — combate à violência à mulher)", "comemorativa"],
  [8, 25, "Dia do Feirante / do Soldado", "comemorativa"],
  [8, 27, "Dia do Psicólogo", "comemorativa"],
  [8, 29, "Dia Nacional de Combate ao Fumo", "saude"],
  [8, 31, "Dia da Nutricionista", "comemorativa"],

  // ---- Setembro (Setembro Amarelo) ----
  [9, 1, "Setembro Amarelo — Prevenção ao Suicídio (mês)", "saude"],
  [9, 5, "Dia da Amazônia", "comemorativa"],
  [9, 7, "Independência do Brasil", "feriado"],
  [9, 10, "Dia Mundial de Prevenção ao Suicídio", "saude"],
  [9, 15, "Dia do Cliente", "comercial"],
  [9, 21, "Dia da Árvore / Luta da Pessoa com Deficiência", "comemorativa"],
  [9, 22, "Início da Primavera", "sazonal"],
  [9, 27, "Dia do Turismo / Dia da Padroeira (Aparecida-região)", "comemorativa"],
  [9, 30, "Dia da Secretária / Dia do Tradutor", "comemorativa"],

  // ---- Outubro (Outubro Rosa) ----
  [10, 1, "Outubro Rosa — Câncer de Mama (mês) / Dia do Idoso", "saude"],
  [10, 4, "Dia Mundial dos Animais / São Francisco", "comemorativa"],
  [10, 5, "Dia das Aves", "comemorativa"],
  [10, 12, "Dia das Crianças / N. Sra. Aparecida", "comercial"],
  [10, 15, "Dia do Professor", "comemorativa"],
  [10, 16, "Dia Mundial da Alimentação / Dia do Chef", "comercial"],
  [10, 18, "Dia do Médico", "comemorativa"],
  [10, 23, "Dia do Aviador / Dia da Aviação", "comemorativa"],
  [10, 24, "Dia das Nações Unidas", "comemorativa"],
  [10, 28, "Dia do Servidor Público", "comemorativa"],
  [10, 31, "Halloween / Dia das Bruxas / Dia da Poupança", "comercial"],

  // ---- Novembro (Novembro Azul) ----
  [11, 1, "Novembro Azul — Saúde do Homem (mês)", "saude"],
  [11, 2, "Finados", "feriado"],
  [11, 5, "Dia da Ciência e Cultura", "comemorativa"],
  [11, 14, "Dia Mundial do Diabetes", "saude"],
  [11, 15, "Proclamação da República", "feriado"],
  [11, 19, "Dia da Bandeira", "comemorativa"],
  [11, 20, "Dia da Consciência Negra", "feriado"],
  [11, 21, "Dia da Saudação / da Homeopatia", "comemorativa"],

  // ---- Dezembro ----
  [12, 1, "Dia Mundial de Combate à AIDS", "saude"],
  [12, 3, "Dia Internacional da Pessoa com Deficiência", "comemorativa"],
  [12, 5, "Dia do Voluntariado", "comemorativa"],
  [12, 10, "Dia dos Direitos Humanos", "comemorativa"],
  [12, 21, "Início do Verão", "sazonal"],
  [12, 24, "Véspera de Natal", "comercial"],
  [12, 25, "Natal", "comercial"],
  [12, 31, "Réveillon (véspera de Ano Novo)", "comercial"],
];

// Datas móveis calculadas para o ano.
function moveis(year) {
  const pascoa = easter(year);
  const maes = nthWeekday(year, 5, 0, 2);   // 2º domingo de maio
  const pais = nthWeekday(year, 8, 0, 2);    // 2º domingo de agosto
  const black = lastWeekday(year, 11, 5);    // última sexta de novembro
  const cyber = addDays(black, 3);           // segunda seguinte
  const noivos = nthWeekday(year, 8, 0, 4);  // 4º domingo de agosto (Dia dos Noivos)
  return [
    { date: dISO(addDays(pascoa, -47)), name: "Carnaval (terça)", category: "sazonal" },
    { date: dISO(addDays(pascoa, -46)), name: "Quarta-feira de Cinzas", category: "sazonal" },
    { date: dISO(addDays(pascoa, -2)), name: "Sexta-feira Santa", category: "feriado" },
    { date: dISO(pascoa), name: "Páscoa", category: "comercial" },
    { date: dISO(addDays(pascoa, 60)), name: "Corpus Christi", category: "feriado" },
    { date: dISO(maes), name: "Dia das Mães", category: "comercial" },
    { date: dISO(pais), name: "Dia dos Pais", category: "comercial" },
    { date: dISO(noivos), name: "Dia dos Noivos", category: "comercial" },
    { date: dISO(black), name: "Black Friday", category: "comercial" },
    { date: dISO(cyber), name: "Cyber Monday", category: "comercial" },
  ];
}

// Todas as datas do ano, ordenadas.
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
