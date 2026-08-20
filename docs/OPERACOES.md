# Operações — Perspecta Creator

Guia curto de tarefas de manutenção. Comandos rodam dentro da pasta `server`.

## Segredos e criptografia

- `JWT_SECRET`: obrigatório em produção. Sem ele, o servidor **recusa subir**
  (fail-fast). Em desenvolvimento, usa um fallback com aviso.
- `ENCRYPTION_KEY`: chave que cifra os segredos no banco (tokens Meta/Asaas,
  chaves de IA, credenciais). Se vazia, usa o `JWT_SECRET` (compatível com o
  que já foi cifrado).

### Separar a ENCRYPTION_KEY do JWT_SECRET (rotação)

Faça isto se quiser poder trocar o `JWT_SECRET` sem perder os segredos cifrados.

1. Descubra a chave **antiga**: é o valor **atual** do `JWT_SECRET` (foi com ele
   que os dados foram cifrados, já que a `ENCRYPTION_KEY` ainda não existia).
2. Gere uma chave **nova** (longa e aleatória) para a `ENCRYPTION_KEY`.
3. No servidor (ou numa cópia do banco), rode a rotação — ela faz um **backup
   antes**:
   ```bash
   OLD_KEY="<jwt_secret atual>" NEW_KEY="<nova chave>" npm run reencrypt
   ```
4. Defina `ENCRYPTION_KEY = <nova chave>` no Render (aba Environment) e reinicie
   o serviço.
5. A partir daí, o `JWT_SECRET` pode ser trocado sem afetar os segredos cifrados.

## Backup do banco

- **Automático:** uma cópia por dia em `/var/data/backups` (mantém as 7 últimas).
- **Manual:** botão **"Backup"** na tela Escritórios (baixa o `agency.db`).
- Cobre o **banco** (dados). As **mídias** (fotos/vídeos em `/var/data/uploads`)
  são protegidas à parte (Cloudflare R2).

## Armazenamento das mídias no Cloudflare R2

O sistema usa o R2 se as 4 variáveis estiverem definidas; senão, usa o disco.

1. No Cloudflare R2, crie um **bucket** e um **API Token** (Object Read & Write).
2. No Render (aba Environment), defina:
   - `R2_ACCOUNT_ID` (o id da conta / subdomínio do endpoint),
   - `R2_ACCESS_KEY_ID`,
   - `R2_SECRET_ACCESS_KEY`,
   - `R2_BUCKET` (nome do bucket).
3. Reinicie o serviço. A partir daí, **novos** uploads vão para o R2.
4. Para mover os arquivos **já existentes** do disco para o R2 (uma vez), rode
   no Shell do Render, dentro de `server`:
   ```bash
   npm run migrate-r2
   ```
   Ele envia cada arquivo, atualiza o banco e apaga a cópia local.

### Restaurar um backup (emergência)

1. Pegue o arquivo do backup (o que você baixou pelo botão "Backup", ou um de
   `/var/data/backups/agency-AAAA-MM-DD.db`).
2. No Render, no **Shell** do serviço, pare a aplicação, substitua o banco e
   suba de novo:
   ```bash
   cp "<arquivo-do-backup>" /var/data/agency.db
   ```
   (Se preferir, guarde o atual antes: `mv /var/data/agency.db /var/data/agency.db.old`.)
3. **Reinicie** o serviço no Render (Manual Deploy → Restart) para ele reabrir o
   banco restaurado.

> O backup é um arquivo SQLite completo — "restaurar" é só colocá-lo no lugar do
> `agency.db` e reiniciar. Há um teste automatizado (`test/backup.test.mjs`) que
> prova que a cópia abre com todos os dados.
