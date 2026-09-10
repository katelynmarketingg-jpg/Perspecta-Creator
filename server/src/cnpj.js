// ---------------------------------------------------------------------------
// Buscar os dados da empresa pelo CNPJ.
//
// A pessoa digita o CNPJ no briefing e o resto vem sozinho: razão social,
// nome fantasia, endereço, telefone, e-mail e quem responde pela empresa.
// Menos digitação para ela, e menos erro de digitação no contrato.
//
// Usa a BrasilAPI, que lê os dados públicos da Receita Federal: é gratuita,
// não exige cadastro nem chave. Se ela estiver fora do ar, o briefing segue —
// os campos ficam para preencher à mão.
// ---------------------------------------------------------------------------

const BASE = process.env.CNPJ_API_URL || "https://brasilapi.com.br/api/cnpj/v1";
const TEMPO_LIMITE = Number(process.env.CNPJ_TIMEOUT_MS) || 8000;

/** Só os dígitos. Devolve null se não tiver os 14. */
export function limpaCnpj(valor) {
  const d = String(valor || "").replace(/\D/g, "");
  return d.length === 14 ? d : null;
}

/** 12.345.678/0001-90 */
export function formataCnpj(valor) {
  const d = limpaCnpj(valor);
  if (!d) return String(valor || "");
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Confere os dígitos verificadores. Evita gastar uma consulta (e o tempo da
 * pessoa) com um número que já se sabe inválido.
 */
export function cnpjValido(valor) {
  const c = limpaCnpj(valor);
  if (!c || /^(\d)\1{13}$/.test(c)) return false;
  const digito = (base) => {
    let peso = base.length - 7, soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return digito(c.slice(0, 12)) === Number(c[12]) && digito(c.slice(0, 13)) === Number(c[13]);
}

function endereco(d) {
  const partes = [
    [d.logradouro, d.numero].filter(Boolean).join(", "),
    d.complemento, d.bairro,
    [d.municipio, d.uf].filter(Boolean).join(" - "),
    d.cep ? `CEP ${String(d.cep).replace(/\D/g, "").replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : "",
  ];
  return partes.map((p) => String(p || "").trim()).filter(Boolean).join(" — ");
}

/**
 * Busca a empresa. Nunca lança: devolve { ok: false, message } quando não dá,
 * para o briefing continuar funcionando mesmo com a consulta fora do ar.
 */
export async function buscaCnpj(valor) {
  const cnpj = limpaCnpj(valor);
  if (!cnpj) return { ok: false, code: "CURTO", message: "O CNPJ precisa ter 14 números." };
  if (!cnpjValido(cnpj)) return { ok: false, code: "INVALIDO", message: "Esse CNPJ não confere. Confira os números." };

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TEMPO_LIMITE);
  try {
    const res = await fetch(`${BASE}/${cnpj}`, { signal: ac.signal, headers: { accept: "application/json" } });
    if (res.status === 404) {
      return { ok: false, code: "NAO_ENCONTRADO", message: "Não achei esse CNPJ na Receita. Confira o número." };
    }
    if (!res.ok) {
      return { ok: false, code: "FORA", message: "A consulta à Receita não respondeu agora. Preencha à mão que dá no mesmo." };
    }
    const d = await res.json();
    // O quadro societário dá quem responde pela empresa — é quem costuma assinar.
    const socios = Array.isArray(d.qsa) ? d.qsa : [];
    const responsavel = socios.find((s) => /administrador|sócio-administrador/i.test(s.qualificacao_socio || ""))
      || socios[0] || null;
    return {
      ok: true,
      cnpj: formataCnpj(cnpj),
      razao_social: d.razao_social || "",
      nome_fantasia: d.nome_fantasia || "",
      endereco: endereco(d),
      municipio: d.municipio || "",
      uf: d.uf || "",
      telefone: d.ddd_telefone_1 ? String(d.ddd_telefone_1).trim() : "",
      email: d.email || "",
      atividade: d.cnae_fiscal_descricao || "",
      abertura: d.data_inicio_atividade || "",
      situacao: d.descricao_situacao_cadastral || "",
      representante: responsavel?.nome_socio || "",
    };
  } catch (e) {
    return {
      ok: false, code: e.name === "AbortError" ? "DEMOROU" : "REDE",
      message: "Não consegui falar com a Receita agora. Preencha à mão que dá no mesmo.",
    };
  } finally {
    clearTimeout(t);
  }
}
