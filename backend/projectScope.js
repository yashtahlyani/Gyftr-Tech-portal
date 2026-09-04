/* ─── Data-integrity helpers that used to be Postgres triggers
   (sync_project_scope, sync_subtask_scope, enforce_stage_target_order in the
   old supabase/schema.sql). None of these are authorization — they don't
   need auth.uid(), just the acting person's team, which every route already
   has from the verified JWT — so they're plain functions the routes call
   inside their transaction, not triggers. ─── */
const { STAGE_OWNER, STAGE_ORDER } = require("./authz");

function growTeams(existing, ...toAdd) {
  return Array.from(new Set([...(existing || []), ...toAdd.filter(Boolean)]));
}

/** Recompute owner_team + involved_teams for a stage change, and stamp
 *  final_go_live the moment a project reaches Live. Call inside the same
 *  transaction as the projects UPDATE, before writing. */
function syncProjectScope({ oldInvolvedTeams, newStage, actingTeam, oldFinalGoLive }) {
  const ownerTeam = STAGE_OWNER[newStage];
  const involvedTeams = growTeams(oldInvolvedTeams, ownerTeam, "business", actingTeam);
  const finalGoLive = newStage === "live" && !oldFinalGoLive
    ? new Date().toISOString().slice(0, 10)
    : oldFinalGoLive;
  return { ownerTeam, involvedTeams, finalGoLive };
}

/** Assigning a sub-task to a team makes the project visible to that team —
 *  e.g. a Design sub-task on a Dev-stage project lets Design see it at all. */
function syncSubtaskScope(oldInvolvedTeams, subtaskTeam) {
  if ((oldInvolvedTeams || []).includes(subtaskTeam)) return oldInvolvedTeams;
  return growTeams(oldInvolvedTeams, subtaskTeam);
}

/** Dates fill in sequentially, stage by stage, in pipeline order. Returns an
 *  error message string if the write should be rejected, or null if it's fine. */
function checkStageTargetOrder(existingTargets, stage, newDate) {
  if (!newDate) return null; // clearing a date is always allowed
  const idx = STAGE_ORDER.indexOf(stage);
  for (let i = 0; i < idx; i++) {
    if (!existingTargets[STAGE_ORDER[i]]) {
      return `Set ${STAGE_ORDER[i]} expected date before ${stage}`;
    }
  }
  const prevDates = STAGE_ORDER.slice(0, idx).map((s) => existingTargets[s]).filter(Boolean);
  const maxPrev = prevDates.sort().at(-1);
  if (maxPrev && newDate < maxPrev) {
    return `Expected date must be on or after the previous stage's date (${maxPrev})`;
  }
  return null;
}

module.exports = { growTeams, syncProjectScope, syncSubtaskScope, checkStageTargetOrder };
