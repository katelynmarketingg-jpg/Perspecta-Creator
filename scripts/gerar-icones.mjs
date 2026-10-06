// ---------------------------------------------------------------------------
// OS ÍCONES DO CREATOR, GERADOS — NÃO RECORTADOS NA MÃO
//
// Pedido dela: "arruma pra nós o favicon do Perspecta Creator, que ele está
// errado, e o ícone que fica na tela do computador quando a gente instala o
// aplicativo, que ele está descentralizado".
//
// Estava os dois: o símbolo tinha sido colado no quadrado sem centralizar, e
// ficou encostado embaixo à direita, com um vazio em cima à esquerda. No
// tamanho de aba (16px) isso vira uma mancha.
//
// E a causa não era a óbvia. Medindo os ícones antigos, as margens eram IGUAIS
// dos dois lados: eles já estavam centralizados pela caixa. O que desequilibra
// é a forma do próprio símbolo — o quadrante vazio fica em cima à esquerda,
// então o peso cai embaixo à direita. Medido: o centro de massa da tinta está
// 11,2% da largura à direita e 8,1% da altura abaixo do meio do quadro.
//
// Por isso aqui a centralizagem é ÓPTICA, não geométrica: o símbolo entra
// deslocado para a esquerda e para cima, o tanto que o peso dele pede, de modo
// que o olho veja no meio. As margens ficam de propósito diferentes.
//
// O símbolo também é mais ALTO do que largo (160×193), então o encaixe é pela
// maior dimensão.
//
// Cada tamanho quer uma folga diferente:
//
//   · favicon (16/32/64px) — quase sem folga. É lido a 16px; margem ali é
//     símbolo menor, e símbolo menor é borrão.
//   · ícone do app (192/512) — folga de respiro, que é como ele aparece na
//     tela do computador e no menu.
//   · maskable — o sistema RECORTA este em círculo, quadrado arredondado ou
//     o que ele quiser, e só garante os 80% centrais. Então o símbolo fica
//     bem menor, inteiro dentro dessa zona segura.
//   · apple-touch — o iOS arredonda sozinho; o fundo tem de sangrar até a
//     borda, senão aparece um quadrado branco atrás.
//
// Como rodar (precisa do Chromium do Playwright, que é o que desenha):
//   node scripts/gerar-icones.mjs
// Dá para apontar outro navegador com CHROMIUM_PATH=/caminho/do/chrome.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const SIMBOLO = join(RAIZ, "client/src/assets/simbolo-perspecta.png");
const DESTINO = join(RAIZ, "client/public");

/** O off-white da marca. É o fundo de todos os ícones. */
const FUNDO = "#ede9de";

// nome, lado do quadrado, quanto do quadrado o símbolo ocupa (pela maior dimensão)
const ICONES = [
  ["favicon-32.png", 32, 0.88],
  ["favicon-64.png", 64, 0.88],
  ["apple-touch-icon.png", 180, 0.70],
  ["icon-192.png", 192, 0.72],
  ["icon-512.png", 512, 0.72],
  ["icon-maskable.png", 512, 0.52],
];

const caminhoDoChromium = () =>
  process.env.CHROMIUM_PATH
  || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((c) => existsSync(c));

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright/index.mjs"
);

const b64 = readFileSync(SIMBOLO).toString("base64");
const navegador = await chromium.launch({ executablePath: caminhoDoChromium() });
const pagina = await navegador.newPage();

for (const [nome, lado, fracao] of ICONES) {
  const dataUrl = await pagina.evaluate(async ({ b64, lado, fracao, fundo }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();

    const c = document.createElement("canvas");
    c.width = lado; c.height = lado;
    const x = c.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.fillStyle = fundo;
    x.fillRect(0, 0, lado, lado);

    // ONDE ESTÁ O PESO DA TINTA. Desenha o símbolo uma vez num quadro auxiliar
    // e pergunta: a média dos pixels opacos cai no meio? No nosso, não — cai
    // embaixo à direita, por causa do quadrante vazio.
    const aux = document.createElement("canvas");
    aux.width = img.width; aux.height = img.height;
    const ax = aux.getContext("2d");
    ax.drawImage(img, 0, 0);
    const d = ax.getImageData(0, 0, aux.width, aux.height).data;
    let sx = 0, sy = 0, peso = 0;
    for (let yy = 0; yy < aux.height; yy++) {
      for (let xx = 0; xx < aux.width; xx++) {
        const a = d[(yy * aux.width + xx) * 4 + 3] / 255;
        if (a > 0.05) { sx += xx * a; sy += yy * a; peso += a; }
      }
    }
    // Quanto o peso está fora do meio, em pixels do PRÓPRIO símbolo.
    const desvioX = peso ? sx / peso - (img.width - 1) / 2 : 0;
    const desvioY = peso ? sy / peso - (img.height - 1) / 2 : 0;

    // O EMPURRÃO NÃO PODE ENCOSTAR NA BORDA. Deslocar para cima e para a
    // esquerda come o lado que já era o mais apertado: no favicon, com 88% de
    // ocupação, o símbolo saiu pela borda de cima — e marca cortada parece
    // defeito, não enquadramento. Então a ocupação pedida é um teto: diminui
    // até sobrar a margem mínima nos quatro lados, já contando o empurrão.
    const MARGEM_MINIMA = 0.045;                 // 4,5% do lado
    let escala = 0, w = 0, h = 0, foraX = 0, foraY = 0;
    for (let f = fracao; f > 0.2; f -= 0.01) {
      escala = (lado * f) / Math.max(img.width, img.height);
      w = img.width * escala; h = img.height * escala;
      foraX = desvioX * escala; foraY = desvioY * escala;
      const esq = (lado - w) / 2 - foraX, dir = (lado - w) / 2 + foraX;
      const topo = (lado - h) / 2 - foraY, base = (lado - h) / 2 + foraY;
      if (Math.min(esq, dir, topo, base) >= lado * MARGEM_MINIMA) break;
    }

    x.drawImage(img, (lado - w) / 2 - foraX, (lado - h) / 2 - foraY, w, h);

    return { url: c.toDataURL("image/png"), usada: Math.max(w, h) / lado };
  }, { b64, lado, fracao, fundo: FUNDO });

  writeFileSync(join(DESTINO, nome), Buffer.from(dataUrl.url.split(",")[1], "base64"));
  const apertou = dataUrl.usada < fracao - 0.005 ? "  (diminuído para não encostar na borda)" : "";
  console.log(`${nome} — ${lado}×${lado}, símbolo em ${Math.round(dataUrl.usada * 100)}%${apertou}`);
}

await navegador.close();
