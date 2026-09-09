// authz.js — server-side authorization, 1:1 port of every Supabase RLS
// policy + SECURITY DEFINER function from supabase/schema.sql, translated
// from the client-side mirror already proven correct in src/roles.ts (same
// shapes, same names where possible — see each function's comment for the
// exact roles.ts / schema.sql counterpart it was ported from).
//
// RDS has no RLS, so this module is now the ONLY security boundary for
// row-level access — every route in routes/ must call the matching guard
// before reading/writing, exactly the way loadProfile.js's req.profile
// replaces `auth.uid()`.
//
// All functions here take plain DB rows (snake_case, as returned by
// backend/serialize.js's *Row helpers or raw `query()`), NOT the camelCase
// shapes src/types.ts uses — those only exist in the frontend.
//
// Original policy / function inventory this file replaces (for audit
// purposes — every name below has a same- or similar-named export here):
//
//   my_team(), my_role() ................ trivial field reads -> myTeam(), myRole()
//   is_overseer() ........................ isOverseer()
//   is_pmo() ............................. isPmo()
//   is_svp() ............................. isSvp() (legacy/dormant, kept for parity)
//   stage_owner(stage) ................... STAGE_OWNER (imported from workflow.js)
//   my_subtree_ids() ..................... orgSubtreeIds(me, allPeople) — ported
//     verbatim from src/roles.ts's orgSubtreeIds, not re-derived.
//   is_hierarchy_person() ................ isHierarchyPerson()
//   is_manager() .......................... isManager() (= hasReports)
//   can_dispatch_pickup() ................ canDispatchPickup()
//   has_coarse_team_leak() ............... hasCoarseTeamLeak()
//   sees_all_projects() .................. seesAllProjects()
//   subtree_owns(pid) .................... subtreeOwns(project, subtreeIds)
//   subtree_leads(pid) ................... subtreeLeads(project, subtreeIds)
//   can_see(pid) .......................... canSee(me, project, allPeople)
//   can_act(pid) .......................... canAct(me, project, allPeople)
//
//   projects policy p_sel (select) ....... canSee() (same shape, inlined
//     subtree check included — see canSee()'s comment on why the inline
//     copy existed in SQL; not needed here, JS has no self-referencing-
//     subquery quirk to dodge)
//   projects policy p_ins (insert) ....... canCreateProject()
//   projects policy p_upd (update, USING + WITH CHECK) + trigger
//     enforce_project_update_scope() ...... enforceProjectUpdateScope() in
//     projectScope.js (needs the OLD row + the requested patch together,
//     so it lives next to sync_project_scope() rather than here)
//   projects policy p_del (delete) ....... isPmo()
//
//   subtasks s_sel ........................ canSee()
//   subtasks s_ins ........................ canCreateSubtask()
//   subtasks s_upd (using + with check) .. canManageSubtask()
//   subtasks s_del ........................ canDeleteSubtask() (same actor set as s_ins)
//
//   stage_targets st_sel .................. canSee()
//   stage_targets st_wr (all) ............. canEditStageTarget()
//   trigger enforce_stage_target_order() .. enforceStageTargetOrder() (projectScope.js)
//
//   stage_history h_sel ................... canSee()
//   stage_history h_ins ................... canInsertStageHistory()
//
//   comments c_sel ......................... canSee()
//   comments c_ins ......................... canSee() (same policy body)
//   comments c_upd ......................... canResolveComment()
//
//   attachments a_sel ...................... canSee()
//   attachments a_ins ...................... canAddAttachment()
//     (attachments a_del: no such policy existed in supabase/schema.sql —
//     RLS therefore denied ALL deletes. This port adds a delete route for
//     UI parity per the migration plan, gated the same as canAddAttachment()
//     — see routes/attachments.js's comment for why this is a deliberate,
//     narrow deviation from a 1:1 port.)
//
//   people people_sel (select using authenticated) ....... every /api route
//     sits behind requireAuth + loadProfile, so "authenticated" is already
//     enforced before any of these functions run; GET /api/people has no
//     extra check, matching the blanket policy.
//   active_people_directory() RPC ......... not ported — CloudLogin.tsx's
//     pre-auth "pick who you are" screen is gone; the new frontend is a
//     real email+password form (see the migration plan's Frontend section).
//   claim_person() RPC ..................... middleware/loadProfile.js
//     (auto-link by verified email on first authenticated request)

const HIERARCHY_TEAMS = new Set(['development', 'qa', 'design', 'business']);

export const myTeam = (me) => me.team;
export const myRole = (me) => me.role;
export const isOverseer = (me) => me.role === 'pmo' || me.role === 'leadership';
export const isPmo = (me) => me.role === 'pmo';
// Legacy/dormant: an earlier design gated subtree visibility on role='svp'.
// The current model applies orgSubtreeIds() structurally to everyone
// instead, so nothing here calls this — kept only for parity with the DB.
export const isSvp = (me) => me.role === 'svp';

/** True if anyone reports (directly or indirectly) to this person. */
export function hasReports(me, allPeople) {
  return allPeople.some((p) => p.manager_id === me.id);
}
export const isManager = hasReports;

/** True if this person is part of any manager_id-linked hierarchy at all. */
export function isHierarchyPerson(me, allPeople) {
  return !!me.manager_id || hasReports(me, allPeople);
}

/** Every person id in `me`'s reporting subtree (including themself), walking
 *  manager_id down from their own row. Ported verbatim from src/roles.ts's
 *  orgSubtreeIds — same shape, same algorithm, snake_case fields. */
export function orgSubtreeIds(me, allPeople) {
  const byManager = new Map();
  for (const p of allPeople) {
    if (!p.manager_id) continue;
    const list = byManager.get(p.manager_id);
    if (list) list.push(p.id); else byManager.set(p.manager_id, [p.id]);
  }
  const out = new Set([me.id]);
  const queue = [me.id];
  while (queue.length) {
    const id = queue.pop();
    for (const childId of byManager.get(id) ?? []) {
      if (!out.has(childId)) { out.add(childId); queue.push(childId); }
    }
  }
  return out;
}

/** True where the old blanket "my team holds court" visibility/action rule
 *  would leak across hierarchy branches. Ported from src/roles.ts's
 *  hasCoarseTeamLeak / the DB's has_coarse_team_leak(). */
export function hasCoarseTeamLeak(me, allPeople) {
  return HIERARCHY_TEAMS.has(me.team) && isHierarchyPerson(me, allPeople);
}

/** Explicit, named "sees every project" grant. */
export const seesAllProjects = (me) => me.sees_all_projects === true;

/** Explicit, data-driven "Project mgmt" dispatch role (department, not a
 *  hardcoded person). Mirrors src/roles.ts's isProjectMgmtDispatcher. */
export const isProjectMgmtDispatcher = (me) => me.department === 'Project mgmt';

/** Can this person dispatch fresh to_be_picked work? Either a real manager
 *  whose subtree includes a tech_spoc/development person, or an explicit
 *  Project-mgmt dispatcher (unrestricted across the whole queue). Mirrors
 *  the DB's can_dispatch_pickup(). */
export function canDispatchPickup(me, allPeople) {
  if (isProjectMgmtDispatcher(me)) return true;
  if (!isManager(me, allPeople)) return false;
  const subtree = orgSubtreeIds(me, allPeople);
  return allPeople.some((p) => subtree.has(p.id) && (p.team === 'tech_spoc' || p.team === 'development'));
}

/** subtree_owns(pid) — the broad OR-chain: any of the four primary project
 *  references, OR a subtask assignee, falls in the subtree. Used for
 *  visibility, hold, and attachments. `project` must include a `subtasks`
 *  array (assignee_id per row) — see serialize.js. */
export function subtreeOwns(project, subtreeIds) {
  if (subtreeLeads(project, subtreeIds)) return true;
  return (project.subtasks ?? []).some((s) => s.assignee_id && subtreeIds.has(s.assignee_id));
}

/** subtree_leads(pid) — narrower sibling, no subtask-assignee branch. Used
 *  for full-column edit rights (isMine()-equivalent) and stage_history
 *  inserts. */
export function subtreeLeads(project, subtreeIds) {
  return [project.owner_id, project.business_owner_id, project.tech_lead_id, project.product_spoc_id]
    .some((id) => id && subtreeIds.has(id));
}

/** can_see(pid) / p_sel — can `me` even see this project? */
export function canSee(me, project, allPeople) {
  if (isOverseer(me) || seesAllProjects(me)) return true;
  const leak = hasCoarseTeamLeak(me, allPeople);
  if (!leak && (project.involved_teams || []).includes(me.team)) return true;
  if (project.stage === 'to_be_picked' && canDispatchPickup(me, allPeople)) return true;
  const subtreeIds = orgSubtreeIds(me, allPeople);
  return subtreeOwns(project, subtreeIds);
}

/** can_act(pid) — can `me` act on it (in-court team, PMO, or — for a
 *  coarse-team-leak actor — full subtree control)? */
export function canAct(me, project, allPeople) {
  if (isPmo(me)) return true;
  const leak = hasCoarseTeamLeak(me, allPeople);
  if (!leak && myTeam(me) === project.owner_team) return true;
  if (leak) {
    const subtreeIds = orgSubtreeIds(me, allPeople);
    return subtreeOwns(project, subtreeIds);
  }
  return false;
}

/** p_ins — project creation. */
export function canCreateProject(me) {
  return isPmo(me) || ['business', 'product', 'tech_spoc'].includes(me.team);
}

/** s_ins — sub-task creation is Product + Tech SPOC (+ PMO) only. */
export function canCreateSubtask(me) {
  return isPmo(me) || me.team === 'product' || me.team === 'tech_spoc';
}

/** s_upd — manage (reassign/edit/delete) a sub-task: Product + Tech SPOC +
 *  PMO, or (own row only) the assignee updating their own promised
 *  date/effort/done flag. */
export function canManageSubtask(me, subtask) {
  return isPmo(me) || me.team === 'product' || me.team === 'tech_spoc' || subtask.assignee_id === me.id;
}

/** s_del — same actor set as creating one (NOT the assignee-own-row carve-out). */
export function canDeleteSubtask(me) {
  return isPmo(me) || me.team === 'product' || me.team === 'tech_spoc';
}

/** st_wr — only the team that owns a given stage may set/update that
 *  stage's expected date (or PMO). `stageOwnerOf` is workflow.js's
 *  STAGE_OWNER lookup, injected to avoid a circular import. */
export function canEditStageTarget(me, stage, stageOwnerOf) {
  return isPmo(me) || myTeam(me) === stageOwnerOf(stage);
}

/** h_ins — stage_history insert. Deliberately NOT canAct(project) — see the
 *  long comment in supabase/schema.sql's h_ins: a transition fires the
 *  projects UPDATE and this history INSERT in the same transaction here
 *  (projectScope.js), which sidesteps the original race-condition reasoning
 *  entirely, but the actor set is kept identical for a faithful port. */
export function canInsertStageHistory(me, project, allPeople) {
  if (isPmo(me)) return true;
  const leak = hasCoarseTeamLeak(me, allPeople);
  if (!leak && (project.involved_teams || []).includes(me.team)) return true;
  if (leak) {
    const subtreeIds = orgSubtreeIds(me, allPeople);
    return subtreeLeads(project, subtreeIds);
  }
  return false;
}

/** c_ins / c_sel — anyone who can see the project may comment. */
export const canComment = canSee;

/** c_upd — resolve/pin a comment: in-court/pmo (canAct), or the author. */
export function canResolveComment(me, project, comment, allPeople) {
  return canAct(me, project, allPeople) || comment.by_id === me.id;
}

/** a_ins — add an attachment: in-court/pmo (canAct), or your team is
 *  already part of the project's story (and, for a coarse-team-leak actor,
 *  the broader subtree-owns check instead of plain team involvement). */
export function canAddAttachment(me, project, allPeople) {
  if (canAct(me, project, allPeople)) return true;
  const leak = hasCoarseTeamLeak(me, allPeople);
  if (leak) {
    const subtreeIds = orgSubtreeIds(me, allPeople);
    return subtreeOwns(project, subtreeIds);
  }
  return (project.involved_teams || []).includes(me.team);
}

/** No a_del policy existed in the source schema (see header comment) — this
 *  narrow addition mirrors canAddAttachment() rather than granting delete to
 *  anyone who can merely see the project. */
export const canDeleteAttachment = canAddAttachment;

// Express middleware helpers, for routes that gate the entire handler on a
// simple project-independent check (mirrors gyftr-legal's requireLegal
// pattern).
export function requireCanCreateProject(req, res, next) {
  if (!canCreateProject(req.profile)) {
    return res.status(403).json({ error: 'Only Business, Product, Tech SPOC, or PMO may create a project' });
  }
  next();
}

export function requireCanCreateSubtask(req, res, next) {
  if (!canCreateSubtask(req.profile)) {
    return res.status(403).json({ error: 'Only Product, Tech SPOC, or PMO may create a sub-task' });
  }
  next();
}
