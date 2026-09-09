// projectScope.js — plain-JS port of supabase/schema.sql's two triggers
// (sync_project_scope / enforce_project_update_scope) plus
// enforce_stage_target_order() and sync_subtask_scope(). Postgres fired
// these automatically inside the same statement RLS was checking; here
// they're ordinary functions the PATCH /api/projects/:id and
// POST /api/projects/:id/subtasks route handlers call explicitly inside a
// db.js withTransaction() block, so "stage transition + stage_history
// insert + involved_teams fold" (or "subtask insert + involved_teams fold")
// still happens atomically.

import { hasCoarseTeamLeak, orgSubtreeIds, subtreeLeads, subtreeOwns, isPmo, myRole, myTeam, canDispatchPickup } from './authz.js';
import { stageOwner, STAGE_ORDER } from './workflow.js';

function dedupe(arr) {
  return Array.from(new Set(arr));
}

/** sync_project_scope() trigger — recomputes owner_team from the (possibly
 *  new) stage, stamps final_go_live the moment a project reaches Live, and
 *  folds owner_team + 'business' + the ACTING user's own team into
 *  involved_teams (folding in the actor's team, not just the new owner, is
 *  what lets e.g. Product create a project on Business's behalf and still
 *  be able to read the row straight back — see the SQL comment this is
 *  ported from).
 *
 *  Only meaningful when `stage` is part of the patch (mirrors the SQL
 *  trigger's `before insert or update of stage`); call sites should only
 *  invoke this when patch.stage is present, or unconditionally on create. */
export function syncProjectScope(oldProjectOrDefaults, patch, actingTeam) {
  const newStage = patch.stage ?? oldProjectOrDefaults.stage;
  const ownerTeam = stageOwner(newStage);
  let finalGoLive = oldProjectOrDefaults.final_go_live ?? null;
  if (newStage === 'live' && !finalGoLive) {
    finalGoLive = new Date().toISOString().slice(0, 10);
  }
  const involvedTeams = dedupe([
    ...(oldProjectOrDefaults.involved_teams ?? ['business']),
    ownerTeam,
    'business',
    actingTeam ?? ownerTeam,
  ]);
  return { owner_team: ownerTeam, involved_teams: involvedTeams, final_go_live: finalGoLive };
}

/** sync_subtask_scope() trigger — assigning a sub-task to a team makes the
 *  project visible to that team. Returns the new involved_teams array, or
 *  null if the team was already included (no write needed). */
export function syncSubtaskScope(project, subtaskTeam) {
  if ((project.involved_teams ?? []).includes(subtaskTeam)) return null;
  return dedupe([...(project.involved_teams ?? []), subtaskTeam]);
}

// ── enforce_project_update_scope() ──
// Column groups exactly as the SQL trigger's is-distinct-from lists.
const ALL_GUARDED_COLUMNS = [
  'title', 'brd', 'partner', 'brand', 'lob', 'priority', 'bifurcation',
  'stage', 'status', 'owner_id', 'business_owner_id', 'blocked', 'block_reason',
  'priority_month', 'dev_effort_days', 'reason_for_delay', 'product_spoc_id', 'tech_lead_id',
  'sacrosanct_go_live', 'target_go_live', 'timeline_eta',
  'on_hold', 'hold_reason', 'held_by_id', 'held_by_team', 'held_at',
];
const HOLD_COLUMNS = ['on_hold', 'hold_reason', 'held_by_id', 'held_by_team', 'held_at'];
// The product-lead-outside-court branch's disallowed list — ALL_GUARDED_COLUMNS
// minus target_go_live/timeline_eta (the dates they're explicitly allowed to
// touch) AND minus the hold columns (not mentioned in that branch's SQL
// check at all — ported exactly as written, not "fixed"; see supabase/
// schema.sql's enforce_project_update_scope() product-lead branch).
const PRODUCT_LEAD_RESTRICTED = ALL_GUARDED_COLUMNS.filter(
  (c) => c !== 'target_go_live' && c !== 'timeline_eta' && !HOLD_COLUMNS.includes(c)
);

function sameValue(a, b) {
  if (a === undefined) return true; // key absent from patch = not a change
  if (a === null && b === null) return true;
  return String(a ?? '') === String(b ?? '');
}

function changedFields(oldProject, patch) {
  return ALL_GUARDED_COLUMNS.filter((f) => f in patch && !sameValue(patch[f], oldProject[f]));
}

/** enforce_project_update_scope() trigger. Throws with the same messages
 *  the SQL trigger raised on rejection; returns (void) if the patch is
 *  allowed. `oldProject` must include `subtasks` (for subtreeOwns) and
 *  `involved_teams`/`owner_team`. */
export function enforceProjectUpdateScope(me, allPeople, oldProject, patch) {
  const changed = changedFields(oldProject, patch);
  if (changed.length === 0) return; // pure bookkeeping (e.g. involved_teams-only cascade) — always allowed

  if (isPmo(me)) return;
  const leak = hasCoarseTeamLeak(me, allPeople);

  if (!leak && myTeam(me) === oldProject.owner_team) return;
  if (oldProject.stage === 'to_be_picked' && myTeam(me) === 'development' && !leak) return;
  if (oldProject.stage === 'to_be_picked' && canDispatchPickup(me, allPeople)) return;
  if (leak && myTeam(me) !== 'business' && subtreeLeads(oldProject, orgSubtreeIds(me, allPeople))) return;

  if (myRole(me) === 'lead' && myTeam(me) === 'product') {
    if (changed.some((f) => PRODUCT_LEAD_RESTRICTED.includes(f))) {
      throw new Error('FORBIDDEN: Product leads may only edit go-live dates (Expected / Timeline ETA) outside their own court');
    }
    return;
  }

  // Business-hierarchy manager: full control of their own branch's work
  // (subtree_leads), EXCEPT the hold columns.
  if (leak && myTeam(me) === 'business' && subtreeLeads(oldProject, orgSubtreeIds(me, allPeople))) {
    if (changed.some((f) => HOLD_COLUMNS.includes(f))) {
      throw new Error('FORBIDDEN: Business may not change hold status');
    }
    return;
  }

  // Any non-Business, non-leadership/svp team already involved (or, for a
  // coarse-team-leak actor, subtree-owning), acting outside their own court:
  // hold columns only.
  if (myRole(me) !== 'leadership' && myRole(me) !== 'svp' && myTeam(me) !== 'business') {
    const subtreeIds = orgSubtreeIds(me, allPeople);
    const connected = leak
      ? subtreeOwns(oldProject, subtreeIds)
      : (oldProject.involved_teams ?? []).includes(myTeam(me));
    if (connected) {
      if (changed.some((f) => !HOLD_COLUMNS.includes(f))) {
        throw new Error('FORBIDDEN: Only hold-related fields may be changed from outside your own court');
      }
      return;
    }
  }

  throw new Error('FORBIDDEN: insufficient_privilege');
}

/** enforce_stage_target_order() trigger. `existingTargets` is every
 *  stage_targets row already on this project (excluding the one being
 *  written), as { stage, expected_date }. Throws on out-of-order dates;
 *  no-op (allowed) when clearing a date. */
export function enforceStageTargetOrder(existingTargets, stage, newExpectedDate) {
  if (newExpectedDate == null) return; // clearing a date is always allowed

  const idx = STAGE_ORDER.indexOf(stage);
  const setStages = new Set(
    existingTargets.filter((t) => t.stage !== stage && t.expected_date != null).map((t) => t.stage)
  );
  for (let i = 0; i < idx; i++) {
    const prior = STAGE_ORDER[i];
    if (!setStages.has(prior)) {
      throw new Error(`INVALID: Set ${prior} expected date before ${stage}`);
    }
  }

  const priorDates = existingTargets
    .filter((t) => STAGE_ORDER.indexOf(t.stage) < idx && t.expected_date)
    .map((t) => t.expected_date);
  if (priorDates.length) {
    const maxPrev = priorDates.reduce((a, b) => (a > b ? a : b));
    if (newExpectedDate < maxPrev) {
      throw new Error(`INVALID: Expected date must be on or after the previous stage's date (${maxPrev})`);
    }
  }
}
