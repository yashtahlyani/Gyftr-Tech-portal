/* ─── Comments: anyone who can see the project may post (incl. read-only
   leadership — that's how priority notes get pinned); only in-court/pmo or
   the comment's own author may resolve one. ─── */
const express = require("express");
const { withTransaction } = require("../db");
const authz = require("../authz");
const { comment } = require("../serialize");
const { loadProjectRow } = require("../projectLoader");
const { asyncHandler } = require("../asyncHandler");

const router = express.Router();

router.post("/", asyncHandler("POST /api/comments", async (req, res) => {
  const { projectId, text, pinned } = req.body;
  const result = await withTransaction(async (client) => {
    const projectRow = await loadProjectRow(client, projectId);
    if (!projectRow) return { status: 404 };
    if (!authz.canComment(req.person, projectRow)) return { status: 403 };
    const { rows } = await client.query(
      "insert into comments (project_id, by_id, text, pinned) values ($1,$2,$3,$4) returning *",
      [projectId, req.person.id, text, pinned ?? false]
    );
    return { status: 200, row: rows[0] };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: "forbidden or not found" });
  res.status(201).json(comment(result.row));
}));

router.post("/:id/resolve", asyncHandler("POST /api/comments/:id/resolve", async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: crows } = await client.query("select * from comments where id = $1", [req.params.id]);
    const c = crows[0];
    if (!c) return { status: 404 };
    const projectRow = await loadProjectRow(client, c.project_id);
    if (!authz.canResolveComment(req.person, projectRow, { byId: c.by_id })) return { status: 403 };
    const { rows } = await client.query("update comments set resolved = true where id = $1 returning *", [req.params.id]);
    return { status: 200, row: rows[0] };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: "forbidden or not found" });
  res.json(comment(result.row));
}));

module.exports = router;
