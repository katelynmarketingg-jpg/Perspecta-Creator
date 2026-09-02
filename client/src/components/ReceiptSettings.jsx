import { useEffect, useState } from "react";
import {
  Card, CardContent, Typography, Stack, TextField, Button, Box, Alert, Divider,
  MenuItem, FormControlLabel, Switch, Chip,
} from "@mui/material";
import api from "../api/client.js";
import SignaturePad from "./SignaturePad.jsx";
import { receiptHtml } from "../receipt.js";

// Lê um arquivo de imagem como data URI (mesmo caminho da logo da marca).
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

const MARCADORES = [
  "cliente", "documento_cliente", "endereco_cliente", "valor", "valor_extenso",
  "descricao", "competencia", "forma_pagamento", "data", "data_extenso",
  "local", "numero", "emitente", "documento_emitente", "endereco_emitente",
];

/**
 * Configurações → Recibos: dados do emitente, a assinatura salva (que sai
 * sozinha em todo recibo) e o modelo com a logo, com prévia ao vivo.
 */
export default function ReceiptSettings() {
  const [dados, setDados] = useState(null);          // emitente + assinatura
  const [modelo, setModelo] = useState(null);        // modelo padrão
  const [previa, setPrevia] = useState(null);
  const [msg, setMsg] = useState(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api.get("/receipts/settings").then((r) => setDados(r.data)).catch(() => {});
    api.get("/receipts/templates/default").then((r) => setModelo(r.data)).catch(() => {});
  }, []);

  // Prévia ao vivo: o servidor devolve o recibo de exemplo com o modelo atual.
  useEffect(() => {
    if (!modelo) return;
    const t = setTimeout(() => {
      api.post("/receipts/templates/preview", { body: modelo.body, style: modelo.style, logo: modelo.logo })
        .then((r) => setPrevia(r.data)).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [modelo?.body, modelo?.logo, JSON.stringify(modelo?.style), dados]);

  const setD = (k) => (e) => setDados((d) => ({ ...d, [k]: e.target.value }));
  const setM = (k) => (e) => setModelo((m) => ({ ...m, [k]: e.target.value }));
  const setEstilo = (k, v) => setModelo((m) => ({ ...m, style: { ...m.style, [k]: v } }));

  async function pickImagem(campo, file, destino) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMsg({ tipo: "error", texto: "Selecione um arquivo de imagem (PNG, JPG, SVG...)." });
      return;
    }
    if (file.size > 500 * 1024) {
      setMsg({ tipo: "error", texto: "Imagem grande demais. Use uma até 500 KB." });
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    if (destino === "modelo") setModelo((m) => ({ ...m, [campo]: dataUrl }));
    else setDados((d) => ({ ...d, [campo]: dataUrl }));
    setMsg(null);
  }

  async function salvar() {
    setSalvando(true);
    try {
      await api.put("/receipts/settings", {
        document: dados.document, address: dados.address, city: dados.city,
        signature_img: dados.signature_img, signer_name: dados.signer_name,
        signer_document: dados.signer_document, signer_role: dados.signer_role,
      });
      const corpo = { name: modelo.name || "Modelo padrão", body: modelo.body, style: modelo.style, logo: modelo.logo, is_default: 1 };
      const { data } = modelo.id
        ? await api.put(`/receipts/templates/${modelo.id}`, corpo)
        : await api.post("/receipts/templates", corpo);
      setModelo(data);
      setMsg({ tipo: "success", texto: "Recibo configurado. Os próximos já saem assim." });
    } catch (err) {
      setMsg({ tipo: "error", texto: err.response?.data?.error || "Não foi possível salvar." });
    }
    setSalvando(false);
    setTimeout(() => setMsg(null), 6000);
  }

  // Nunca some a seção: se ainda não carregou (ou uma chamada falhou), mostra o
  // card com "Carregando…" em vez de sumir — assim a Katelyn sempre acha os Recibos.
  if (!dados || !modelo) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 0.5 }}>Recibos</Typography>
          <Typography variant="body2" color="text.secondary">Carregando…</Typography>
        </CardContent>
      </Card>
    );
  }
  const st = modelo.style || {};
  // A prévia vem do servidor, mas o que ainda não foi salvo (assinatura, CNPJ,
  // endereço) entra por cima — assim dá para ver antes de gravar.
  const previaAoVivo = previa && {
    ...previa,
    signature_img: dados.signature_img, signer_name: dados.signer_name,
    signer_document_fmt: dados.signer_document, signer_role: dados.signer_role,
    emitter_document_fmt: dados.document, emitter_address: dados.address,
    place: dados.city || previa.place,
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 0.5 }}>Recibos</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Quando você marca uma receita como <b>paga</b>, o recibo é gerado sozinho com estes
          dados — numerado, com a logo e com a assinatura salva. Você e o cliente podem baixar.
        </Typography>
        {msg && <Alert severity={msg.tipo} sx={{ mb: 2 }}>{msg.texto}</Alert>}

        <Stack spacing={2}>
          <Divider>Quem emite (sai no recibo)</Divider>
          <TextField label="Razão social / nome" value={dados.emitter_name || ""} fullWidth disabled
            helperText="É o nome do escritório — mude em Organizações." />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="CNPJ / CPF" value={dados.document || ""} onChange={setD("document")} fullWidth />
            <TextField label="Cidade (local e data)" value={dados.city || ""} onChange={setD("city")} fullWidth />
          </Stack>
          <TextField label="Endereço" value={dados.address || ""} onChange={setD("address")} fullWidth />

          <Divider>Assinatura salva</Divider>
          <Typography variant="caption" color="text.secondary">
            Desenhe (ou envie) uma vez: ela passa a sair em todo recibo, junto do nome e
            do documento de quem assina — sem precisar assinar de novo.
          </Typography>
          <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap" }}>
            <Box sx={{
              minWidth: 200, minHeight: 80, px: 2, py: 1, borderRadius: 2, border: "1px dashed",
              borderColor: "divider", bgcolor: "#fff", display: "grid", placeItems: "center",
            }}>
              {dados.signature_img
                ? <Box component="img" src={dados.signature_img} alt="Assinatura"
                    sx={{ maxHeight: 70, maxWidth: 240, objectFit: "contain" }} />
                : <Typography variant="caption" color="text.secondary">sem assinatura</Typography>}
            </Box>
            <Stack spacing={1}>
              <Button variant="outlined" component="label" size="small">
                Enviar imagem da assinatura
                <input hidden type="file" accept="image/*"
                  onChange={(e) => pickImagem("signature_img", e.target.files?.[0])} />
              </Button>
              {dados.signature_img && (
                <Button size="small" color="error"
                  onClick={() => setDados((d) => ({ ...d, signature_img: null }))}>Remover</Button>
              )}
            </Stack>
          </Box>
          <Box sx={{ maxWidth: 420 }}>
            <SignaturePad onChange={(img) => setDados((d) => ({ ...d, signature_img: img || null }))} />
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Quem assina" value={dados.signer_name || ""} onChange={setD("signer_name")} fullWidth />
            <TextField label="CPF do signatário" value={dados.signer_document || ""} onChange={setD("signer_document")} fullWidth />
          </Stack>
          <TextField label="Cargo" value={dados.signer_role || ""} onChange={setD("signer_role")} fullWidth
            placeholder="Ex.: Sócia-administradora" />

          <Divider>Modelo do recibo</Divider>
          <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
            <Box sx={{
              height: 56, minWidth: 140, px: 2, borderRadius: 2, border: "1px dashed",
              borderColor: "divider", bgcolor: "#fff", display: "grid", placeItems: "center",
            }}>
              {modelo.logo
                ? <Box component="img" src={modelo.logo} alt="Logo" sx={{ height: 42, maxWidth: 200, objectFit: "contain" }} />
                : <Typography variant="caption" color="text.secondary">usa a logo da marca</Typography>}
            </Box>
            <Button variant="outlined" component="label" size="small">
              Logo do recibo
              <input hidden type="file" accept="image/*"
                onChange={(e) => pickImagem("logo", e.target.files?.[0], "modelo")} />
            </Button>
            {modelo.logo && (
              <Button size="small" color="error" onClick={() => setModelo((m) => ({ ...m, logo: null }))}>
                Usar a logo da marca
              </Button>
            )}
          </Box>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Título do documento" value={st.header || ""}
              onChange={(e) => setEstilo("header", e.target.value)} fullWidth />
            <TextField label="Cor de destaque" type="color" value={st.accent || "#EA580C"}
              onChange={(e) => setEstilo("accent", e.target.value)} sx={{ width: 120 }} />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField select label="Posição da logo" value={st.logo_align || "left"}
              onChange={(e) => setEstilo("logo_align", e.target.value)} fullWidth>
              <MenuItem value="left">Esquerda</MenuItem>
              <MenuItem value="center">Centro</MenuItem>
              <MenuItem value="right">Direita</MenuItem>
            </TextField>
            <TextField label="Altura da logo (px)" type="number" value={st.logo_height || 56}
              onChange={(e) => setEstilo("logo_height", Number(e.target.value) || 56)} fullWidth />
          </Stack>
          <TextField label="Rodapé (opcional)" value={st.footer || ""}
            onChange={(e) => setEstilo("footer", e.target.value)} fullWidth
            placeholder="Ex.: Dúvidas: financeiro@suaagencia.com.br" />
          <FormControlLabel
            control={<Switch checked={st.show_signature !== false}
              onChange={(e) => setEstilo("show_signature", e.target.checked)} />}
            label="Mostrar a assinatura no recibo"
          />

          <TextField label="Texto do recibo" value={modelo.body || ""} onChange={setM("body")}
            fullWidth multiline minRows={5}
            helperText="Use os marcadores abaixo — eles são trocados pelos dados de cada pagamento." />
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {MARCADORES.map((m) => (
              <Chip key={m} size="small" variant="outlined" label={`{{${m}}}`}
                onClick={() => setModelo((mo) => ({ ...mo, body: `${mo.body || ""}{{${m}}}` }))} />
            ))}
          </Box>

          <Divider>Prévia</Divider>
          <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden", bgcolor: "#fff" }}>
            <iframe title="Prévia do recibo" srcDoc={previaAoVivo ? receiptHtml(previaAoVivo) : ""}
              style={{ width: "100%", height: 560, border: 0 }} />
          </Box>

          <Button variant="contained" onClick={salvar} disabled={salvando} sx={{ alignSelf: "flex-start" }}>
            {salvando ? "Salvando…" : "Salvar modelo e assinatura"}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
