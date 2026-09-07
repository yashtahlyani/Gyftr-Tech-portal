/* ─── Attachments: in-court/pmo, or your team is already part of the
   project's story. Mirrors the fixed canAddAttachment from src/roles.ts —
   deliberately narrower than commenting; visibility alone isn't enough. ─── */
const express = require("express");
const { withTransaction } = require("../db");
const authz = require("../authz");
const { attachment } = require("../serialize");
const { loadProjectRow } = require("../projectLoader");

const router = express.Router();

router.post("/", async (req, res) => {
  const { projectId, name, kind, url } = req.body;
  const result = await withTransaction(async (client) => {
    const projectRow = await loadProjectRow(client, projectId);
    if (!projectRow) return { status: 404 };
    if (!authz.canAddAttachment(req.person, projectRow)) return { status: 403 };
    const { rows } = await client.query(
      "insert into attachments (project_id, by_id, name, kind, url) values ($1,$2,$3,$4,$5) returning *",
      [projectId, req.person.id, name, kind, url ?? null]
    );
    return { status: 200, row: rows[0] };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: "forbidden or not found" });
  res.status(201).json(attachment(result.row));
});

module.exports = router;
