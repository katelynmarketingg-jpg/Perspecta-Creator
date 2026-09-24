import { imprimirDocumento } from "./impressao.js";
import { currency } from "./utils.js";

// ---------------------------------------------------------------------------
// O PDF DE ENTREGA DA LANDING PAGE.
//
// É o documento que o cliente guarda: o que ele comprou, onde está o site, o
// que vence quando, e quanto custa renovar. Escrito para ser lido daqui a um
// ano por alguém que não lembra de nada da conversa.
//
// SENHA NENHUMA ENTRA AQUI, de propósito. PDF é encaminhado, fica salvo em
// e-mail, vai para o WhatsApp e acaba em muitos lugares. As senhas vão
// separadas, por um link que expira.
// ---------------------------------------------------------------------------

const dataBR = (d) => (d ? d.split("-").reverse().join("/") : "—");
const escapa = (t) => String(t ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export function htmlDeEntrega(lp, agencia = {}) {
  const site = lp.endereco || "";
  const renovacao = lp.proxima_renovacao?.valor ?? lp.valor_renovacao;
  const contato = [agencia.email, agencia.telefone].filter(Boolean).join(" · ");

  const linha = (rotulo, valor) =>
    `<tr><td style="padding:4px 14px 4px 0;color:#57534e;white-space:nowrap">${rotulo}</td>
         <td style="padding:4px 0"><b>${escapa(valor)}</b></td></tr>`;

  return `
<h1>Seu site está no ar</h1>
<p class="sobretitulo">${escapa(agencia.nome || "")}</p>

<p>Olá, ${escapa(lp.client_name)}! Este documento reúne tudo o que você precisa saber sobre o
seu site — guarde-o, porque ele responde as dúvidas que costumam aparecer daqui a alguns meses.</p>

<h2>O seu site</h2>
<table>
  ${linha("Endereço", site || "—")}
  ${linha("No ar desde", dataBR(lp.publicado_em))}
  ${linha("Primeira renovação", dataBR(lp.vence_em))}
</table>

<h2>O que está incluso no primeiro ano</h2>
<ul>
  <li>Registro e manutenção do domínio <b>${escapa(site)}</b>;</li>
  <li>Hospedagem do site e certificado de segurança (o cadeado do navegador);</li>
  <li>O site no ar, monitorado, com as correções necessárias para funcionar;</li>
  <li>Os ajustes de conteúdo combinados na entrega.</li>
</ul>

<h2>A renovação anual</h2>
<p>A partir de <b>${dataBR(lp.vence_em)}</b>, a manutenção do site é renovada a cada 12 meses,
no valor de <b>${currency(renovacao)}</b>. A renovação cobre o domínio, a hospedagem e o
certificado de segurança pelo ano seguinte.</p>
<p>Entraremos em contato com antecedência para combinar o pagamento. Se a renovação não for
paga até a data de vencimento, o site sai do ar e o domínio pode ser liberado para outra
pessoa registrar.</p>

<h2>Onde está o seu domínio</h2>
<p>O domínio <b>${escapa(site)}</b> está registrado no <b>Registro.br</b>, em seu nome — ele é
seu, não nosso. O acesso ao painel (${escapa("https://registro.br")}) é feito com o seu CPF ou
CNPJ e a senha que enviamos separadamente.</p>
<p><b>As senhas não estão neste documento de propósito</b>: um PDF é encaminhado e fica salvo em
muitos lugares. Elas foram enviadas por uma mensagem à parte — guarde-as em um lugar seguro e
troque no primeiro acesso.</p>

<h2>Como pedir alterações</h2>
<p>Para mudar textos, fotos ou informações do site, é só nos chamar. Pequenos ajustes de conteúdo
são combinados caso a caso; alterações maiores (novas páginas, novas seções, mudança de layout)
são orçadas antes, e você aprova o valor antes de qualquer coisa começar.</p>

<h2>Falar com a gente</h2>
<p>${escapa(agencia.nome || "")}${contato ? `<br>${escapa(contato)}` : ""}</p>
`;
}

/** Abre o PDF de entrega pronto para imprimir ou salvar. */
export function pdfDeEntrega(lp, agencia = {}) {
  return imprimirDocumento({
    titulo: `Entrega — ${lp.client_name}`,
    corpo: htmlDeEntrega(lp, agencia),
    estiloExtra: `
      .folha h2 { margin-top: 20px; margin-bottom: 6px; }
      .folha table { margin: 6px 0 2px; }
      .folha li { margin-bottom: 4px; }
    `,
  });
}
