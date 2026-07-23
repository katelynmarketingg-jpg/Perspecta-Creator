// Service worker mínimo: deixa o app instalável e responde offline com uma
// mensagem clara em vez de erro do navegador. Nada de cachear a API — dados
// desatualizados numa ferramenta de trabalho confundem mais do que ajudam.
const CACHE = "perspecta-v2";
// Não pré-cacheamos o index.html: ele muda a cada publicação e precisa vir
// sempre da rede, senão o app abre uma versão velha.
const SHELL = ["/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // API sempre da rede

  // Navegação: sempre da rede (para pegar a versão nova). Offline mostra aviso.
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request).catch(() => new Response(
        "<h1>Sem conexão</h1><p>Reconecte para continuar.</p>",
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      ))
    );
    return;
  }

  // Estáticos (JS/CSS/imagens do build): cache primeiro, atualiza depois.
  e.respondWith(
    caches.match(request).then((hit) =>
      hit || fetch(request).then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copia));
        }
        return res;
      })
    )
  );
});
