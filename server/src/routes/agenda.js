import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();
router.use(authRequired);

const SELECT = `
  SELECT e.*, et.name AS type_name, et.color AS type_color, c.name AS client_name,
         u.name AS owner_name
  FROM events e
  LEFT JOIN event_types et ON et.id = e.type_id
  LEFT JOIN clients c ON c.id = e.client_id
  LEFT JOIN users u ON u.id = e.owner_id`;

// GET /api/agenda?from=&to=&owner_id= — eventos no intervalo (agenda de cada um)
router.get("/", (req, res) => {
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const to = req.query.to || from;
  const where = ["date(e.start_at) BETWEEN @from AND @to"];
  const params = { from, to };
  if (req.query.owner_id) { where.push("e.owner_id = @owner_id"); params.owner_id = req.query.owner_id; }
  res.json(db.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY e.start_at`).all(params));
});

// GET /api/agenda/day?date=&owner_id= — eventos de um dia
router.get("/day", (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const where = ["date(e.start_at) = @date"];
  const params = { date };
  if (req.query.owner_id) { where.push("e.owner_id = @owner_id"); params.owner_id = req.query.owner_id; }
  res.json(db.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY e.start_at`).all(params));
});

export default router;
