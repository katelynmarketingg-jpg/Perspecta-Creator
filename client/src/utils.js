export function currency(value) {
  return (Number(value) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR");
}

export function monthLabel(ym) {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  const names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${names[Number(m) - 1] || m}/${String(y).slice(2)}`;
}

export const PRIORITY = {
  low: { label: "Baixa", color: "default" },
  medium: { label: "Média", color: "warning" },
  high: { label: "Alta", color: "error" },
};

// Tipos de conteúdo produzidos pela agência.
export const CONTENT_TYPES = {
  post: { label: "Post", emoji: "🖼️" },
  reel: { label: "Reel", emoji: "🎬" },
  foto: { label: "Foto", emoji: "📸" },
  stories: { label: "Stories", emoji: "⚡" },
  outro: { label: "Outro", emoji: "📌" },
};

export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function formatTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function fileSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
