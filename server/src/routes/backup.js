import { Router } from "express";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs";
import { authRequired, superadminRequired } from "../auth.js";
import { makeBackup } from "../backup.js";

// Só o dono do sistema (Perspecta Media) baixa o banco inteiro.
const router = Router();
router.use(authRequired, superadminRequired);

// GET /api/backup/download — gera uma cópia consistente e baixa pelo navegador.
router.get("/download", async (req, res) => {
  const tmp = join(tmpdir(), `agency-backup-${Date.now()}.db`);
  try {
    await makeBackup(tmp);
    const nome = `agency-${new Date().toISOString().slice(0, 10)}.db`;
    res.download(tmp, nome, () => { unlink(tmp, () => {}); });
  } catch (e) {
    res.status(500).json({ error: "Falha ao gerar backup: " + e.message });
  }
});

export default router;
