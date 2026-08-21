// Catálogo de datas comemorativas/sazonais do Brasil (as mais usadas por
// agências e social media). Datas fixas + móveis calculadas por ano.

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
const FIXAS = [
  [1, 1, "Confraternização Universal (Ano Novo)", "feriado"],
  [1, 9, "Dia do Fico", "comemorativa"],
  [2, 14, "Dia dos Namorados (internacional)", "comercial"],
  [3, 8, "Dia Internacional da Mulher", "comemorativa"],
  [3, 15, "Dia do Consumidor", "comercial"],
  [3, 21, "Início do Outono", "sazonal"],
  [4, 1, "Dia da Mentira", "comemorativa"],
  [4, 21, "Tiradentes", "feriado"],
  [4, 22, "Descobrimento do Brasil", "comemorativa"],
  [5, 1, "Dia do Trabalho", "feriado"],
  [6, 5, "Dia Mundial do Meio Ambiente", "comemorativa"],
  [6, 12, "Dia dos Namorados", "comercial"],
  [6, 24, "São João (Festas Juninas)", "sazonal"],
  [7, 20, "Dia do Amigo", "comemorativa"],
  [8, 11, "Dia do Estudante", "comemorativa"],
  [9, 7, "Independência do Brasil", "feriado"],
  [9, 15, "Dia do Cliente", "comercial"],
  [9, 21, "Dia da Árvore", "comemorativa"],
  [9, 23, "Início da Primavera", "sazonal"],
  [10, 12, "Dia das Crianças / N. Sra. Aparecida", "comercial"],
  [10, 15, "Dia do Professor", "comemorativa"],
  [10, 31, "Halloween / Dia das Bruxas", "comercial"],
  [11, 2, "Finados", "feriado"],
  [11, 15, "Proclamação da República", "feriado"],
  [11, 20, "Dia da Consciência Negra", "feriado"],
  [12, 21, "Início do Verão", "sazonal"],
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
  return [
    { date: dISO(addDays(pascoa, -47)), name: "Carnaval (terça)", category: "sazonal" },
    { date: dISO(addDays(pascoa, -2)), name: "Sexta-feira Santa", category: "feriado" },
    { date: dISO(pascoa), name: "Páscoa", category: "comercial" },
    { date: dISO(maes), name: "Dia das Mães", category: "comercial" },
    { date: dISO(pais), name: "Dia dos Pais", category: "comercial" },
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
};
