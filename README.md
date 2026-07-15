# SaaS Agency — Gestão para Agências

Recriação do sistema `app.perspectivaagencia.com.br` com stack moderna, pronta para
receber melhorias. Monorepo simples com **backend** (API) e **client** (SPA) separados.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + Vite + **Material UI (MUI)** + React Router + Recharts |
| HTTP | Axios (`baseURL: /api`, token Bearer) |
| Auth | JWT (token no `localStorage`) |
| Backend | Node + Express |
| Banco | SQLite (better-sqlite3) — arquivo único, zero config |

## Módulos

Dashboard · Clientes · Projetos · Tarefas (Kanban) · Financeiro · Contratos ·
Metas · Agenda · Eventos · Relatórios · Usuários & Permissões · Configurações

## Como rodar

### 1. Backend
```bash
cd server
cp .env.example .env
npm install
npm run seed     # cria admin + dados de exemplo
npm run dev      # http://localhost:8080
```
Login inicial: **admin@agencia.com / admin123**

### 2. Frontend
```bash
cd client
npm install
npm run dev      # http://localhost:5173 (proxy /api -> :8080)
```

## Deploy (produção)
```bash
cd client && npm run build      # gera client/dist
cd ../server && npm start        # Express serve a API + o build do client
```

## Estrutura
```
saas-agency/
  server/
    src/
      index.js         # app Express + rotas + static
      db.js            # schema SQLite
      auth.js          # JWT + hash + middlewares
      seed.js          # dados iniciais
      routes/          # auth, users, clients, projects, tasks,
                       # financial, contracts, goals, events, agenda, reports
  client/
    src/
      api/client.js    # axios central
      auth/            # AuthContext (login/registro/sessão)
      components/      # Layout (sidebar) + ui compartilhada
      pages/           # 13 telas
      App.jsx          # rotas
```

## Endpoints principais
- `POST /api/auth/login` · `POST /api/auth/register` · `GET /api/auth/me`
- `GET/POST/PUT/DELETE /api/clients|projects|tasks|financial|contracts|goals|events`
- `GET /api/tasks/stages` · `PUT /api/tasks/:id/status` · `PUT /api/tasks/:id/tags`
- `GET /api/users` · `GET/PUT /api/users/:id/permissions`
- `GET /api/reports/dashboard|billing-by-client|billing-by-month|tasks-by-user`
- `GET /api/financial/summary` · `GET /api/agenda/day`
