// routes/projects.js — replaces supabase.from('projects')... calls
// (src/cloudStore.ts's fetchAll/patchProject/createProject/etc).
//
// GET / mirrors the old nested select (`*, subtasks(*), stage_history(*),
// comments(*), attachments(*), stage_targets(*)`) via serialize.js's
// jsonb_agg query, then filters in JS with authz.js's canSee() — the exact
// same predicate supabase/schema.sql's p_sel policy evaluated per-row.
//
// PATCH /:id is the single endpoint behind every mutation cloudStore.ts
// used to fire as a raw `.update()` (transition, updateDetails, setStatus,
// reassign, pickUp, requestClarification, reopen, setBlock, setHold) — the
// old RLS p_upd policy + enforce_project_update_scope() trigger didn't care
// which UI action produced the UPDATE, only what changed and who changed
// it, so one guarded PATCH is a faithful port. It atomically writes a
// stage_history row in the same transaction when the stage/status changed
// or a note was given (see projectScope.js's header on why this is now
// atomic instead of the old fire-and-forget pair of requests).
//
// Errors are thrown with FORBIDDEN:/NOT_FOUND:/INVALID: tags and mapped to
// HTTP status by errors.js's handle() wrapper — see that file.

import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { canSee, isPmo, requireCanCreateProject, canInsertStageHistory } from '../authz.js';
import { syncProjectScope, enforceProjectUpdateScope } from '../projectScope.js';
import { fetchAllPeople, fetchProjectNestedById, PROJECT_NESTED_SELECT } from '../serialize.js';
import { handle, HttpError } from '../errors.js';

const router = Router();

// GET /api/projects — every project the caller can see, newest first.
router.get('/', handle(async (req, res) => {
  const allPeople = await fetchAllPeople(query);
  const { rows } = await query(`${PROJECT_NESTED_SELECT} order by p.created_at desc`);
  const visible = rows.filter((p) => canSee(req.profile, p, allPeople));
  res.json(visible);
}));

// POST /api/projects — create + optional subtasks + "Project created" history.
// RLS was: p_ins with check (is_pmo() or my_team() in ('business','product','tech_spoc')).
router.post('/', requireCanCreateProject, handle(async (req, res) => {
  const f = req.body;
  const projectId = await withTransaction(async (client) => {
    const scope = syncProjectScope(
      { stage: f.stage, involved_teams: ['business'], final_go_live: null },
      { stage: f.stage },
      req.profile.team
    );
    const { rows } = await client.query(
      `insert into projects
         (title, brd, partner, brand, lob, priority, bifurcation, stage, status,
          owner_id, business_owner_id, blocked, block_reason,
          target_go_live, sacrosanct_go_live, priority_month, timeline_eta,
          dev_effort_days, reason_for_delay, product_spoc_id, tech_lead_id,
          owner_team, involved_teams, final_go_live)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       returning *`,
      [
        f.title, f.brd ?? '', f.partner, f.brand ?? null, f.lob ?? null,
        f.priority ?? 'P1', f.bifurcation ?? 'B2C', f.stage, f.status,
        f.owner_id ?? null, f.business_owner_id ?? null, f.blocked ?? false, f.block_reason ?? null,
        f.target_go_live ?? null, f.sacrosanct_go_live ?? null, f.priority_month ?? null, f.timeline_eta ?? null,
        f.dev_effort_days ?? null, f.reason_for_delay ?? null, f.product_spoc_id ?? null, f.tech_lead_id ?? null,
        scope.owner_team, scope.involved_teams, scope.final_go_live,
      ]
    );
    const project = rows[0];

    if (Array.isArray(f.subtasks) && f.subtasks.length) {
      for (const s of f.subtasks) {
        await client.query(
          `insert into subtasks (project_id, title, team, assignee_id, done)
           values ($1,$2,$3,$4,$5)`,
          [project.id, s.title, s.team, s.assigneeId ?? s.assignee_id ?? null, s.done ?? false]
        );
      }
    }

    await client.query(
      `insert into stage_history (project_id, by_id, from_stage, to_stage, from_status, to_status, note)
       values ($1,$2,null,$3,null,$4,'Project created')`,
      [project.id, f.business_owner_id ?? req.profile.id, project.stage, project.status]
    );

    return project.id;
  });

  const nested = await fetchProjectNestedById(query, projectId);
  res.status(201).json(nested);
}));

// PATCH /api/projects/:id — see file header.
router.patch('/:id', handle(async (req, res) => {
  const { id } = req.params;
  const { note, ...patch } = req.body ?? {};
  const allPeople = await fetchAllPeople(query);

  const updatedId = await withTransaction(async (client) => {
    const { rows } = await client.query('select * from projects where id = $1 for update', [id]);
    const oldProject = rows[0];
    if (!oldProject) throw new HttpError(404, 'NOT_FOUND: project');
    const { rows: subtaskRows } = await client.query(
      'select id, team, assignee_id from subtasks where project_id = $1', [id]
    );
    oldProject.subtasks = subtaskRows;

    enforceProjectUpdateScope(req.profile, allPeople, oldProject, patch);

    let finalPatch = { ...patch };
    if ('stage' in patch) {
      const scope = syncProjectScope(oldProject, patch, req.profile.team);
      finalPatch = { ...finalPatch, ...scope };
    }

    const setCols = Object.keys(finalPatch);
    if (setCols.length) {
      const setClause = setCols.map((c, i) => `${c} = $${i + 2}`).join(', ');
      await client.query(`update projects set ${setClause} where id = $1`, [id, ...setCols.map((c) => finalPatch[c])]);
    }

    const stageChanged = 'stage' in patch && patch.stage !== oldProject.stage;
    const statusChanged = 'status' in patch && patch.status !== oldProject.status;
    if (note || stageChanged || statusChanged) {
      if (canInsertStageHistory(req.profile, oldProject, allPeople)) {
        await client.query(
          `insert into stage_history (project_id, by_id, from_stage, to_stage, from_status, to_status, note)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [
            id, req.profile.id, oldProject.stage,
            patch.stage ?? oldProject.stage, oldProject.status, patch.status ?? oldProject.status,
            note ?? null,
          ]
        );
      } else {
        console.warn(`[PATCH /projects/${id}] history skipped — ${req.profile.email} can't insert stage_history for this project (best-effort, same as the old fire-and-forget insert)`);
      }
    }

    return id;
  });

  const nested = await fetchProjectNestedById(query, updatedId);
  res.json(nested);
}));

// DELETE /api/projects/:id — PMO only (p_del).
router.delete('/:id', handle(async (req, res) => {
  if (!isPmo(req.profile)) throw new HttpError(403, 'FORBIDDEN: Only PMO may delete a project');
  await query('delete from projects where id = $1', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
