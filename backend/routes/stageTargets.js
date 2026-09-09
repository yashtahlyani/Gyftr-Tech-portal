// routes/stageTargets.js — replaces supabase.from('stage_targets').upsert(...)
// (src/cloudStore.ts's setStageTarget). Mounted at /api.

import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { canEditStageTarget } from '../authz.js';
import { enforceStageTargetOrder } from '../projectScope.js';
import { stageOwner } from '../workflow.js';
import { handle, HttpError } from '../errors.js';

const router = Router();

// PUT /api/projects/:projectId/stage-targets/:stage — st_wr: only the team
// that owns `stage` (or PMO), enforcing pipeline-order sequencing
// (enforce_stage_target_order()).
router.put('/projects/:projectId/stage-targets/:stage', handle(async (req, res) => {
  const { projectId, stage } = req.params;
  const { expectedDate, expected_date } = req.body ?? {};
  const newDate = expectedDate ?? expected_date ?? null;

  if (!canEditStageTarget(req.profile, stage, stageOwner)) {
    throw new HttpError(403, `FORBIDDEN: only ${stageOwner(stage)} (or PMO) may set the ${stage} expected date`);
  }

  const row = await withTransaction(async (client) => {
    const { rows: existing } = await client.query(
      'select stage, expected_date from stage_targets where project_id = $1', [projectId]
    );
    enforceStageTargetOrder(existing, stage, newDate);

    const { rows } = await client.query(
      `insert into stage_targets (project_id, stage, expected_date, updated_by, updated_at)
       values ($1,$2,$3,$4,now())
       on conflict (project_id, stage) do update
         set expected_date = excluded.expected_date, updated_by = excluded.updated_by, updated_at = now()
       returning *`,
      [projectId, stage, newDate, req.profile.id]
    );
    return rows[0];
  });

  res.json(row);
}));

export default router;
