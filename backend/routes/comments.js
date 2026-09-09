// routes/comments.js — replaces supabase.from('comments')... calls
// (src/cloudStore.ts's addComment/resolveNote). Mounted at /api.

import { Router } from 'express';
import { query } from '../db.js';
import { canSee, canResolveComment } from '../authz.js';
import { fetchAllPeople, fetchProjectForAuthz } from '../serialize.js';
import { handle, HttpError } from '../errors.js';

const router = Router();

// POST /api/projects/:projectId/comments — c_ins: anyone who can see the project.
router.post('/projects/:projectId/comments', handle(async (req, res) => {
  const { projectId } = req.params;
  const { text, pinned } = req.body;

  const allPeople = await fetchAllPeople(query);
  const project = await fetchProjectForAuthz(query, projectId);
  if (!project) throw new HttpError(404, 'NOT_FOUND: project');
  if (!canSee(req.profile, project, allPeople)) throw new HttpError(403, 'FORBIDDEN: cannot comment on a project you cannot see');

  const { rows } = await query(
    `insert into comments (project_id, by_id, text, pinned) values ($1,$2,$3,$4) returning *`,
    [projectId, req.profile.id, text, pinned ?? false]
  );
  res.status(201).json(rows[0]);
}));

// PATCH /api/comments/:id — c_upd: in-court/pmo (canAct), or the author.
// cloudStore.ts's resolveNote() only ever sets `resolved`.
router.patch('/comments/:id', handle(async (req, res) => {
  const { id } = req.params;
  const { rows } = await query('select * from comments where id = $1', [id]);
  const comment = rows[0];
  if (!comment) throw new HttpError(404, 'NOT_FOUND: comment');

  const allPeople = await fetchAllPeople(query);
  const project = await fetchProjectForAuthz(query, comment.project_id);
  if (!project) throw new HttpError(404, 'NOT_FOUND: project');
  if (!canResolveComment(req.profile, project, comment, allPeople)) {
    throw new HttpError(403, 'FORBIDDEN: cannot resolve this note');
  }

  const { resolved } = req.body ?? {};
  await query('update comments set resolved = $2 where id = $1', [id, resolved ?? true]);
  const { rows: updated } = await query('select * from comments where id = $1', [id]);
  res.json(updated[0]);
}));

export default router;
