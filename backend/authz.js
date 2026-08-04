/* ─── Server-side authorization — the single source of truth now that RLS is
   gone. Every function here ports one policy from the old supabase/schema.sql
   (cited in each comment) or one gate from src/roles.ts, kept under the same
   name so the two are easy to eyeball against each other. RDS itself is only
   reachable from this API's security group, so this file — not the DB — is
   the actual security boundary. ─── */

const STAGE_ORDER = ["intake", "scoping", "to_be_picked", "development", "qa", "uat", "pre_prod", "live"];

// Mirrors schema.sql's stage_owner(s stage_id). UAT is owned by Product, not
// Business — go-live/deploy approval sits with Product per the CEO's process.
const STAGE_OWNER = {
  intake: "business",
  scoping: "product",
  to_be_picked: "tech_spoc",
  development: "development",
  qa: "qa",
  uat: "product",
  pre_prod: "development",
  live: "leadership",
};

const isPmo = (person) => person.role === "pmo";
const isOverseer = (person) => person.role === "pmo" || person.role === "leadership";
// Leadership is a pure read-only observer — full visibility, zero edits. Mirrors roles.ts's isReadOnly.
const isReadOnly = (person) => person.role === "leadership";

const ownerTeam = (project) => STAGE_OWNER[project.stage];

// Mirrors roles.ts's isMine — deliberately team-based, not "or it's assigned to me".
function isMine(person, project) {
  if (project.stage === "live") return false;
  return ownerTeam(project) === person.team;
}

// projects: p_sel — is_overseer() or my_team() = any(involved_teams)
function canSeeProject(person, project) {
  return isOverseer(person) || (project.involvedTeams || []).includes(person.team);
}

// projects: p_ins — pmo or business/product/tech_spoc
function canCreateProject(person) {
  return isPmo(person) || ["business", "product", "tech_spoc"].includes(person.team);
}

// projects: p_del — pmo only
function canDeleteProject(person) {
  return isPmo(person);
}

// Generic "can act on this project" gate — mirrors roles.ts's can(action, me, proj)
// for status/assign/block/reopen/clarify: pmo always; otherwise isMine (in-court team only).
function canActOnProject(person, project) {
  if (isReadOnly(person)) return false;
  if (isPmo(person)) return true;
  return isMine(person, project);
}

// roles.ts's can("pickup", ...): to_be_picked stage, tech_spoc or development team.
function canPickup(person, project) {
  if (isReadOnly(person)) return false;
  return project.stage === "to_be_picked" && ["tech_spoc", "development"].includes(person.team);
}

// Product leads may edit go-live dates on ANY project, not just their own court —
// they renegotiate dates with partners without waiting on whoever holds the ball.
// Mirrors p_upd's extra clause + enforce_project_update_scope()'s column guard.
function isProductLeadAnywhere(person) {
  return person.role === "lead" && person.team === "product";
}

// Drawer.tsx's canEditDates: normal in-court edit rights, OR a product lead
// editing from outside their court (date-only — enforced by the route, not here).
function canEditProjectDates(person, project) {
  if (isReadOnly(person)) return false;
  return canActOnProject(person, project) || isProductLeadAnywhere(person);
}

// canPerformTransition: going live is the deploying team's call, not PMO's —
// deliberately NOT pmo-bypassable, unlike every other transition.
function canPerformTransition(person, project, spec) {
  if (isReadOnly(person)) return false;
  const isGoLive = project.stage === "pre_prod" && spec.kind === "forward" && spec.to === "live";
  if (isGoLive) return isMine(person, project);
  if (project.stage === "to_be_picked" && spec.kind === "forward") return canPickup(person, project);
  return canActOnProject(person, project);
}

// subtasks: s_ins — pmo or product/tech_spoc (they scope the work)
function canCreateSubtask(person) {
  return isPmo(person) || ["product", "tech_spoc"].includes(person.team);
}

// subtasks: s_upd — management team, OR the assignee acting on their own row
function canUpdateSubtask(person, subtask) {
  return isPmo(person) || ["product", "tech_spoc"].includes(person.team) || subtask.assigneeId === person.id;
}

// subtasks: s_del — management team only, no assignee escape hatch
function canDeleteSubtask(person) {
  return isPmo(person) || ["product", "tech_spoc"].includes(person.team);
}

// Drawer.tsx's canManage / canToggle split, now the actual server contract:
// reassign/remove/expected-date is management-only; toggling done is management OR the assignee.
function canManageSubtask(person) { return canCreateSubtask(person); }
function canToggleSubtask(person, subtask) { return canManageSubtask(person) || subtask.assigneeId === person.id; }

// stage_targets: st_wr + trg_stage_target_order — only the team that OWNS that
// specific stage (or pmo) may set/edit its date, and only once every earlier
// stage already has one. `existingTargets` is { [stage]: expectedDateOrNull }.
function canEditStageTarget(person, stage, existingTargets) {
  if (isReadOnly(person)) return false;
  if (!isPmo(person) && STAGE_OWNER[stage] !== person.team) return false;
  const idx = STAGE_ORDER.indexOf(stage);
  for (let i = 0; i < idx; i++) {
    if (!existingTargets[STAGE_ORDER[i]]) return false;
  }
  return true;
}

// attachments: a_ins, corrected to match the fixed client-side canAddAttachment
// (roles.ts) rather than the DB's original a_ins, which let read-only leadership
// see a working upload form pre-Live and have the write silently rejected.
function canAddAttachment(person, project) {
  if (isReadOnly(person)) return false;
  if (isPmo(person)) return true;
  return ownerTeam(project) === person.team || (project.involvedTeams || []).includes(person.team);
}

// comments: c_ins — anyone who can see the project (incl. leadership) may comment
function canComment(person, project) {
  return canSeeProject(person, project);
}

// comments: c_upd — in-court/pmo, or the comment's own author
function canResolveComment(person, project, comment) {
  return canActOnProject(person, project) || isPmo(person) || comment.byId === person.id;
}

module.exports = {
  STAGE_ORDER, STAGE_OWNER,
  isPmo, isOverseer, isReadOnly, ownerTeam, isMine,
  canSeeProject, canCreateProject, canDeleteProject, canActOnProject, canPickup,
  isProductLeadAnywhere, canEditProjectDates, canPerformTransition,
  canCreateSubtask, canUpdateSubtask, canDeleteSubtask, canManageSubtask, canToggleSubtask,
  canEditStageTarget, canAddAttachment, canComment, canResolveComment,
};
