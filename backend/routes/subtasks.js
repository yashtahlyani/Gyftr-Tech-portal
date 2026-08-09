/* ─── Sub-tasks: create (product/tech_spoc/pmo only), toggle/reassign/edit
   (management team, or the assignee acting on their own row — split exactly
   like Drawer.tsx's canManage/canToggle), delete (management team only). ─── */
const express = require("express");
const { withTransaction, query } = require("../db");
const authz = require("../authz");
const { syncSubtaskScope } = require("../projectScope");
const { subtask } = require("../serialize");

const router = express.Router();

async function loadSubtaskRow(client, id) {
  const { rows } = await client.query("select * from subtasks where id = $1", [id]);
  return rows[0] ?? null;
}
async function loadProjectRowLite(client, id) {
  const { rows } = await client.query("select id, stage, owner_team, involved_teams from projects where id = $1", [id]);
  if (!rows[0]) return null;
  return { id: rows[0].id, stage: rows[0].stage, ownerTeam: rows[0].owner_team, involvedTeams: rows[0].involved_teams };
}

router.post("/", async (req, res) => {
  if (!authz.canCreateSubtask(req.person)) return res.status(403).json({ error: "forbidden" });
  const b = req.body; // { projectId, title, team, assigneeId?, done, expectedDate? }
  const row = await withTransaction(async (client) => {
    const projectRow = await loadProjectRowLite(client, b.projectId);
    if (!projectRow) return null;
    const involvedTeams = syncSubtaskScope(projectRow.involvedTeams, b.team);
    if (involvedTeams !== projectRow.involvedTeams) {
      await client.query("update projects set involved_teams = $1 where id = $2", [involvedTeams, b.projectId]);
    }
    const { rows } = await client.query(
      `insert into subtasks (project_id, title, team, assignee_id, done, expected_date)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [b.projectId, b.title, b.team, b.assigneeId ?? null, b.done ?? false, b.expectedDate ?? null]
    );
    return rows[0];
  });
  if (!row) return res.status(404).json({ error: "project not found" });
  res.status(201).json(subtask(row));
});

router.post("/:id/toggle", async (req, res) => {
  const result = await withTransaction(async (client) => {
    const s = await loadSubtaskRow(client, req.params.id);
    if (!s) return { status: 404 };
    if (!authz.canToggleSubtask(req.person, { assigneeId: s.assignee_id })) return { status: 403 };
    const { rows } = await client.query("update subtasks set done = not done where id = $1 returning *", [req.params.id]);
    return { status: 200, row: rows[0] };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: "forbidden or not found" });
  res.json(subtask(result.row));
});

router.post("/:id/reassign", async (req, res) => {
  const { assigneeId } = req.body;
  const result = await withTransaction(async (client) => {
    const s = await loadSubtaskRow(client, req.params.id);
    if (!s) return { status: 404 };
    if (!authz.canManageSubtask(req.person)) return { status: 403 };
    const { rows } = await client.query("update subtasks set assignee_id = $1 where id = $2 returning *", [assigneeId ?? null, req.params.id]);
    return { status: 200, row: rows[0] };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: "forbidden or not found" });
  res.json(subtask(result.row));
});

// Assigner sets expectedDate (management only); assignee sets promisedDate/effortDays on their own row.
router.patch("/:id", async (req, res) => {
  const patch = req.body;
  const result = await withTransaction(async (client) => {
    const s = await loadSubtaskRow(client, req.params.id);
    if (!s) return { status: 404 };
    const isAssignee = s.assignee_id === req.person.id;
    const isManager = authz.canManageSubtask(req.person);
    if (!isManager && !isAssignee) return { status: 403 };
    if ("expectedDate" in patch && !isManager) return { status: 403, error: "Only Product/Tech SPOC/PMO set the expected date" };
    if (("promisedDate" in patch || "effortDays" in patch) && !isAssignee && req.person.role !== "pmo") {
      return { status: 403, error: "Only the assignee (or PMO) sets their own promised date/effort" };
    }
    const colMap = { promisedDate: "promised_date", effortDays: "effort_days", expectedDate: "expected_date" };
    const sets = []; const values = []; let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      if (!colMap[k]) continue;
      sets.push(`${colMap[k]} = $${i++}`);
      values.push(v ?? null);
    }
    if (!sets.length) return { status: 200, row: s };
    values.push(req.params.id);
    const { rows } = await client.query(`update subtasks set ${sets.join(", ")} where id = $${i} returning *`, values);
    return { status: 200, row: rows[0] };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error || "forbidden or not found" });
  res.json(subtask(result.row));
});

router.delete("/:id", async (req, res) => {
  const { rows } = await query("select id from subtasks where id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).end();
  if (!authz.canDeleteSubtask(req.person)) return res.status(403).json({ error: "forbidden" });
  await query("delete from subtasks where id = $1", [req.params.id]);
  res.status(204).end();
});

module.exports = router;
