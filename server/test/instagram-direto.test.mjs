// "PRECISO QUE OS POSTS VÃO DIRETO AO INSTAGRAM — COMO FUNCIONA HOJE?"
//
// Funciona: o caminho inteiro existe e está testado (foto, carrossel, reels,
// botão na mão, robô de 5 em 5 minutos, fila, avisos). O que falta é o app da
// Meta — três chaves que só ela pode criar, no painel de developers.
//
// O buraco era de INFORMAÇÃO: a tela dizia "falta criar o app" e parava aí.
// Faltava o passo a passo, e faltava o endereço de retorno — que é onde essa
// configuração mais trava, porque a Meta exige que ele seja igual letra por
// letra e, quando não é, responde "URL bloqueada" sem dizer qual é a certa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ler = (p) => readFileSync(join(RAIZ, p), "utf8");
const rotas = ler("server/src/routes/integrations.js");
const tela = ler("client/src/pages/Integrations.jsx");
const render = ler("render.yaml");
const doc = ler("docs/INSTAGRAM.md");

test("o servidor diz o endereço de retorno exato, montado por ele mesmo", () => {
  assert.match(rotas, /const retornoCerto = `\$\{publicBaseUrl\(req\)\}\/api\/integrations\/meta\/callback`/,
    "adivinhar o endereço é o erro que faz a Meta responder 'URL bloqueada'");
  assert.match(rotas, /retorno_certo: retornoCerto/);
});

test("o servidor diz QUAIS das três chaves faltam", () => {
  assert.match(rotas, /const faltando = \["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"\]/);
  assert.match(rotas, /\.filter\(\(k\) => !process\.env\[k\]\)/);
});

test("endereço configurado diferente do que o sistema atende é denunciado", () => {
  // Pior que desligado: o login da Meta abre, pede as permissões e morre no meio.
  assert.match(rotas, /retorno_confere:/);
  assert.match(tela, /status\?\.configured && status\.retorno_confere === false/);
  assert.match(tela, /O endereço de retorno não bate/);
});

test("a tela mostra o passo a passo, não só o que falta", () => {
  assert.match(tela, /Falta ligar o app da Meta/);
  assert.match(tela, /Login do Facebook/);
  assert.match(tela, /Instagram Graph API/);
  assert.match(tela, /\{status\.retorno_certo\}/, "o endereço pronto para colar, na tela");
  assert.match(tela, /conta profissional/, "sem o vínculo com a Página, a Meta não publica");
});

test("as três chaves estão declaradas no Render", () => {
  for (const k of ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"]) {
    assert.match(render, new RegExp(`- key: ${k}\\n\\s+sync: false`),
      `${k} tem de aparecer na aba Environment para ela poder preencher`);
  }
});

test("o passo a passo escrito cobre o que só se descobre apanhando", () => {
  assert.match(doc, /App Review|Acesso avançado/, "sem isso o app só publica nas contas da própria casa");
  assert.match(doc, /instagram_content_publish/);
  assert.match(doc, /letra por letra/, "o endereço de retorno é onde isto mais trava");
  assert.match(doc, /reel/i, "reel sai à mão de propósito — para não perder qualidade");
});

// ---------------------------------------------------------------------------
// "ISSO JÁ TENHO APP E TUDO MAIS."
//
// O app existir não é o que o sistema usa: ele usa o que está nas variáveis do
// servidor. Entre as duas coisas cabem erros que nenhuma tela mostra — chave
// de outro app, espaço colado no fim, App Secret regenerado na Meta depois de
// copiado. Em todos eles o botão "Conectar" aparece, ela clica, e quem diz não
// é a Meta, num inglês que não ajuda.
// ---------------------------------------------------------------------------
const meta = ler("server/src/meta.js");

test("dá para perguntar à META se as chaves do servidor são de um app de verdade", () => {
  assert.match(meta, /export async function conferirApp\(\)/);
  assert.match(meta, /access_token: `\$\{META_APP_ID\}\|\$\{META_APP_SECRET\}`/,
    "o token de aplicativo só vale com os DOIS certos — é a conferência que se quer");
  assert.match(rotas, /router\.post\("\/meta\/teste"/);
});

test("o teste responde as três coisas que travam a publicação direta", () => {
  const rota = rotas.slice(rotas.indexOf('router.post("/meta/teste"'), rotas.indexOf('router.post("/meta/connect"'));
  assert.match(rota, /retorno_confere:/, "endereço de retorno igual ao que o sistema atende");
  assert.match(rota, /endereco_publico:/, "sem PUBLIC_URL o robô não monta o link que a Meta baixa");
  assert.match(rota, /conferirApp\(\)/, "as chaves são de um app que a Meta reconhece");
});

test("chave errada vira frase com o que fazer, não o inglês da Meta", () => {
  assert.match(meta, /A Meta não reconheceu o par App ID \+ App Secret/);
  assert.match(meta, /Se o App Secret foi gerado de novo lá, o antigo deixou de valer/);
});

test("rede caída não é confundida com chave errada", () => {
  // "fetch failed" cru faria parecer que a chave está errada — e ela iria
  // mexer no que estava certo.
  assert.match(meta, /fetch failed\|ENOTFOUND\|ECONNREFUSED/);
  assert.match(meta, /Isso é rede, não chave/);
});

test("o botão está na tela, e o resultado diz cada uma das três", () => {
  assert.match(tela, /As chaves da Meta estão funcionando\?/);
  assert.match(tela, /onClick=\{testarMeta\}/);
  assert.match(tela, /A Meta reconheceu o app/);
  assert.match(tela, /Endereço de retorno não confere/);
  assert.match(tela, /Falta o endereço público/);
});

// ---------------------------------------------------------------------------
// APP "LOGIN DO FACEBOOK PARA EMPRESAS" — o tipo que a Meta cria hoje.
//
// Nele as permissões não vão na chamada do login: ficam numa CONFIGURAÇÃO
// feita no painel, e a chamada manda só o número dela. Mandar `scope` num app
// desses devolve um acesso SEM instagram_content_publish — e o erro só aparece
// lá na frente, na hora de postar, longe de onde o problema está.
// ---------------------------------------------------------------------------
test("com configuração, o login vai por config_id; sem ela, por scope", () => {
  assert.match(meta, /export const META_CONFIG_ID = process\.env\.META_CONFIG_ID \|\| ""/);
  assert.match(meta, /if \(META_CONFIG_ID\) params\.set\("config_id", META_CONFIG_ID\);\s*\n\s*else params\.set\("scope", META_SCOPES\);/,
    "um ou outro: a Meta diz que o config_id substitui o scope");
});

test("o app clássico continua funcionando igual", () => {
  assert.match(meta, /Vazio = app com o Login do Facebook clássico/,
    "quem já está ligado não pode quebrar por causa de uma variável nova");
  assert.match(render, /- key: META_CONFIG_ID\n\s+sync: false/);
});

test("a tela avisa quando falta a configuração — antes de o erro aparecer longe", () => {
  assert.match(tela, /Sem <code>META_CONFIG_ID<\/code>/);
  assert.match(tela, /sem permissão de publicar/);
  assert.match(doc, /META_CONFIG_ID/);
  assert.match(doc, /instagram_content_publish/);
});
