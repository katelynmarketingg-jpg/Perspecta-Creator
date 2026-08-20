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
