// Troca de senha, uso único, das duas contas-semente — a partir das variáveis
// SEED_ADMIN_PASSWORD e SEED_KATY_PASSWORD. NÃO troca a senha de ninguém
// automaticamente: só roda quando VOCÊ executa este comando, de propósito.
//
// Como rodar (no Shell do Render, dentro de server):
//   SEED_ADMIN_PASSWORD="nova-do-admin" SEED_KATY_PASSWORD="nova-da-katy" npm run reset-senha
// (pode rodar só uma das duas, definindo só a variável correspondente.)
import bcrypt from "bcryptjs";
import { db } from "./db.js";

const alvos = [
  { email: "admin@perspectamedia.com", env: "SEED_ADMIN_PASSWORD", rotulo: "admin (superadmin)" },
  { email: "katy@perspectiva.com", env: "SEED_KATY_PASSWORD", rotulo: "Katy (admin)" },
];

let trocadas = 0;
for (const a of alvos) {
  const senha = process.env[a.env];
  if (!senha) { console.log(`• Pulei ${a.rotulo}: defina ${a.env} para trocar.`); continue; }
  const u = db.prepare("SELECT id FROM users WHERE email = ?").get(a.email);
  if (!u) { console.error(`• Conta ${a.email} não encontrada.`); continue; }
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?")
    .run(bcrypt.hashSync(senha, 10), u.id);
  console.log(`✅ Senha de ${a.rotulo} (${a.email}) trocada.`);
  trocadas++;
}
console.log(`\n${trocadas} conta(s) atualizada(s).`);
process.exit(0);
