// routes/subtasks.js — replaces supabase.from('subtasks')... calls
// (src/cloudStore.ts's addSubtask/toggleSubtask/updateSubtask/removeSubtask/
// reassignSubtask). Mounted at /api (paths below are the full route).

import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { canManageSubtask, canDeleteSubtask, requireCanCreateSubtask } from '../authz.js';
import { syncSubtaskScope } from '../projectScope.js';
import { handle, HttpError } from '../errors.js';

const router = Router();

// POST /api/projects/:projectId/subtasks — s_ins: Product + Tech SPOC + PMO.
// Also folds the sub-task's team into involved_teams (sync_subtask_scope()).
router.post('/projects/:projectId/subtasks', requireCanCreateSubtask, handle(async (req, res) => {
  const { projectId } = req.params;
  const { title, team, assigneeId, assignee_id, done, expectedDate, expected_date } = req.body;

  const subtask = await withTransaction(async (client) => {
    const { rows: projRows } = await client.query(
      'select id, involved_teams from projects where id = $1 for update', [projectId]
    );
    if (!projRows[0]) throw new HttpError(404, 'NOT_FOUND: project');

    const { rows } = await client.query(
      `insert into subtasks (project_id, title, team, assignee_id, done, expected_date)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [projectId, title, team, assigneeId ?? assignee_id ?? null, done ?? false, expectedDate ?? expected_date ?? null]
    );

    const newInvolved = syncSubtaskScope(projRows[0], team);
    if (newInvolved) {
      await client.query('update projects set involved_teams = $2 where id = $1', [projectId, newInvolved]);
    }

    return rows[0];
  });

  res.status(201).json(subtask);
}));

// PATCH /api/subtasks/:id — s_upd: Product + Tech SPOC + PMO, or (own row
// only) the assignee updating their own promised date/effort/done flag.
router.patch('/subtasks/:id', handle(async (req, res) => {
  const { id } = req.params;
  const { rows } = await query('select * from subtasks where id = $1', [id]);
  const subtask = rows[0];
  if (!subtask) throw new HttpError(404, 'NOT_FOUND: subtask');
  if (!canManageSubtask(req.profile, subtask)) {
    throw new HttpError(403, 'FORBIDDEN: cannot manage this sub-task');
  }

  const allowed = ['title', 'team', 'assignee_id', 'done', 'expected_date', 'promised_date', 'effort_days'];
  const patch = req.body ?? {};
  const cols = allowed.filter((c) => c in patch);
  if (cols.length) {
    const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    await query(`update subtasks set ${setClause} where id = $1`, [id, ...cols.map((c) => patch[c])]);
  }
  const { rows: updated } = await query('select * from subtasks where id = $1', [id]);
  res.json(updated[0]);
}));

// DELETE /api/subtasks/:id — s_del: Product + Tech SPOC + PMO only.
router.delete('/subtasks/:id', handle(async (req, res) => {
  if (!canDeleteSubtask(req.profile)) throw new HttpError(403, 'FORBIDDEN: only Product, Tech SPOC, or PMO may delete a sub-task');
  await query('delete from subtasks where id = $1', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
