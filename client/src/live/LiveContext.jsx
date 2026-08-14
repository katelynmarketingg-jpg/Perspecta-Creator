import { createContext, useContext, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Atualização ao vivo no lado das telas.
//
// Abre UM único canal (EventSource) para /api/live e mantém um "contador de
// versão" por recurso (tasks, clients, financial, ...). Toda vez que alguém do
// mesmo escritório grava algo, o contador daquele recurso sobe. As telas usam
// esse número nas dependências do useEffect de carga: quando ele muda, a tela
// recarrega sozinha só o que mudou.
// ---------------------------------------------------------------------------

const LiveCtx = createContext({ versions: {}, connected: false });

export function LiveProvider({ children }) {
  const [versions, setVersions] = useState({});
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);

  useEffect(() => {
    let stopped = false;
    let retry;

    function connect() {
      const token = localStorage.getItem("token");
      if (!token) return; // sem login, sem canal

      let url = `/api/live?token=${encodeURIComponent(token)}`;
      try {
        // Master olhando um escritório específico: ouve o canal daquele org.
        const viewing = JSON.parse(localStorage.getItem("viewing_org") || "null");
        if (viewing?.id) url += `&org=${viewing.id}`;
      } catch {
        /* sem escritório selecionado */
      }

      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => setConnected(true);

      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          // Mensagens internas (__hello) não disparam recarga.
          if (msg?.resource && !msg.resource.startsWith("__")) {
            setVersions((v) => ({ ...v, [msg.resource]: (v[msg.resource] || 0) + 1 }));
          }
        } catch {
          /* linha que não é JSON (ex.: ping) — ignora */
        }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        if (!stopped) retry = setTimeout(connect, 5000); // reconecta sozinho
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      esRef.current?.close();
    };
  }, []);

  return (
    <LiveCtx.Provider value={{ versions, connected }}>{children}</LiveCtx.Provider>
  );
}

// Retorna um número que muda toda vez que 'resource' é alterado por qualquer
// pessoa do escritório. Coloque-o nas dependências do seu useEffect de carga:
//   const v = useLiveVersion("tasks");
//   useEffect(() => { carregar(); }, [v]);
export function useLiveVersion(resource) {
  const { versions } = useContext(LiveCtx);
  return versions[resource] || 0;
}

// Status do canal (conectado ou não) — útil para um indicador na interface.
export function useLiveStatus() {
  return useContext(LiveCtx);
}
