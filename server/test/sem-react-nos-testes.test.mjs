// OS TESTES DO SERVIDOR RODAM SEM AS DEPENDÊNCIAS DO CLIENT.
//
// Vários testes daqui leem módulos do client para travar uma conta que a tela
// faz (o corte do carrossel, a resolução da prévia, a rolagem ao arrastar).
// Isso só funciona enquanto esses módulos forem CONTA PURA: no CI, `server/`
// tem as suas dependências instaladas e `react` não está entre elas.
//
// Foi exatamente assim que um módulo novo derrubou o CI passando aqui na
// máquina — aqui o `client/node_modules` existe e o import resolvia. Este teste
// fecha essa porta: qualquer módulo do client importado por um teste do
// servidor não pode depender de react.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, "../..");

// Todo import de "../../client/..." que aparece nos testes.
function modulosDoClientUsadosNosTestes() {
  const achados = new Set();
  for (const nome of readdirSync(aqui).filter((n) => n.endsWith(".test.mjs"))) {
    const fonte = readFileSync(join(aqui, nome), "utf8");
    for (const m of fonte.matchAll(/["'`](\.\.\/\.\.\/client\/src\/[^"'`]+)["'`]/g)) {
      // Só o que é IMPORTADO de verdade; ler o arquivo como texto é inofensivo.
      const linha = fonte.slice(Math.max(0, m.index - 120), m.index);
      if (/import\s*\(?\s*$|from\s*$/.test(linha)) achados.add(m[1]);
    }
  }
  return [...achados].sort();
}

const DEPS_SO_DO_CLIENT = /from\s+["'](react|react-dom|@mui\/[^"']+|axios|react-router[^"']*)["']/;

test("módulo do client lido por teste do servidor não depende de react & cia", () => {
  const usados = modulosDoClientUsadosNosTestes();
  assert.ok(usados.length, "algum teste lê módulo do client — é o caso que este teste protege");
  const sujos = [];
  for (const rel of usados) {
    const caminho = resolve(aqui, rel);
    const fonte = readFileSync(caminho, "utf8");
    const achado = fonte.match(DEPS_SO_DO_CLIENT);
    if (achado) sujos.push(`${rel} importa ${achado[1]}`);
  }
  assert.deepEqual(sujos, [],
    "esses módulos quebram o CI, que roda sem as dependências do client instaladas");
});
