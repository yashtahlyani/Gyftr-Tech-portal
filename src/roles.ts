/* ─── Roles, visibility scoping & permissions ─── */
import type { Person, Project, StageId, TeamId, ViewKey } from "./types";
import { STAGES, STAGE_ORDER, STAGE_BY_ID, type TransitionSpec } from "./workflow";
import { PEOPLE } from "./people";

export type Action =
  | "create" | "pickup" | "advance" | "status" | "block"
  | "clarify" | "reopen" | "assign" | "comment" | "subtask";

export const isOverseer = (p: Person) => p.role === "pmo" || p.role === "leadership";
/** Leadership and (legacy) SVP-role people are pure read-only observers.
 *  The current org hierarchy (any depth — see orgSubtreeIds/hasReports below)
 *  doesn't need this: its people are structurally read-only already, since
 *  their team never holds court on any pipeline stage. */
export const isReadOnly = (p: Person) => p.role === "leadership" || p.role === "svp";
/** Explicit, named "sees every project" grant (people.sees_all_projects) —
 *  data-driven, not a hierarchy derivation. Visibility only; doesn't imply
 *  write access the way PMO/leadership's overseer status does. */
export const hasGlobalView = (p: Person) => isOverseer(p) || p.seesAllProjects === true;
/** True if anyone reports (directly or indirectly) to this person — i.e.
 *  they're a node with real descendants, not a leaf. Purely structural. */
export function hasReports(me: Person, all: Person[]): boolean {
  return all.some((p) => p.managerId === me.id);
}
/** True if this person is part of any manager_id-linked hierarchy at all
 *  (has a manager, or has reports). Mirrors the DB's is_hierarchy_person(). */
export function isHierarchyPerson(me: Person, all: Person[]): boolean {
  return !!me.managerId || hasReports(me, all);
}
/** Direct-or-indirect manager, i.e. has at least one report. Mirrors the
 *  DB's is_manager() — the actor class allowed to assign new pickup-stage
 *  work to a specific report, rather than everyone on the team self-serving. */
export const isManager = hasReports;
/** True where the old blanket "my team holds court" visibility/action rule
 *  would leak across hierarchy branches — specifically the 3 team_id values
 *  (development/qa/design) that coarsely cram ~15 real Tech departments into
 *  one workflow court. Product/Business/Tech-SPOC courts map 1:1 to real
 *  departments and never hit this, even for people who happen to carry a
 *  manager_id (e.g. Anandita, a Product lead who also appears in the Tech
 *  org chart) — gating on team, not merely "is in a hierarchy", avoids
 *  stripping their normal team-court visibility. Mirrors the DB's
 *  has_coarse_team_leak() exactly. */
export function hasCoarseTeamLeak(me: Person, all: Person[]): boolean {
  return (me.team === "development" || me.team === "qa" || me.team === "design") && isHierarchyPerson(me, all);
}
/** Board/list/escalations/overview nav (vs. queue/team) — overseers, anyone
 *  with a global-view grant, and anyone who has real reports (their subtree
 *  visibility is more useful through the full board than "my court"). */
export function hasOrgNav(p: Person, all: Person[]): boolean {
  return isOverseer(p) || hasGlobalView(p) || hasReports(p, all);
}

/** Team currently holding the ball. */
export function ownerTeam(p: Project): TeamId {
  return STAGE_BY_ID[p.stage].owner;
}

/** In *my* court right now — strictly: my TEAM holds the ball. Deliberately NOT
 *  "or it's personally assigned to me": if data ever names an owner from another
 *  team, that person must not keep acting on a court that isn't theirs — being
 *  the named assignee grants visibility (see visibleTo), never cross-team action. */
export function isMine(me: Person, proj: Project): boolean {
  if (proj.stage === "live") return false;
  if (hasCoarseTeamLeak(me, PEOPLE)) {
    // Full control over anyone in your own subtree's work — an SVP overseeing
    // a branch that spans multiple coarse team_id values (dev/qa/design sub-
    // departments) must be able to act on it at any stage, not just while it
    // happens to sit in the ONE team value that's personally theirs. Gated
    // on subtree membership, not team-court, so cross-branch isolation still
    // holds. subtreeLeads(), not subtreeVisibleTo() — a subtask-only
    // connection is too light to justify full-column edit rights. Mirrors
    // the DB's p_upd subtree_leads() branch exactly.
    const subtree = orgSubtreeIds(me, PEOPLE);
    return subtreeLeads(proj, subtree);
  }
  return ownerTeam(proj) === me.team;
}

/** Every team that has been (or is) part of a project's journey. Keyed off the
 *  FURTHEST stage ever reached (per history), not just the current one — a live
 *  project reopened back to Dev must stay visible to QA/UAT teams who tested it.
 *  Mirrors the DB's involved_teams (backfill + triggers in schema.sql). */
export function teamsInvolved(proj: Project): Set<TeamId> {
  let maxIdx = STAGE_ORDER.indexOf(proj.stage);
  for (const h of proj.history) {
    maxIdx = Math.max(maxIdx, STAGE_ORDER.indexOf(h.toStage));
    if (h.fromStage) maxIdx = Math.max(maxIdx, STAGE_ORDER.indexOf(h.fromStage));
  }
  const teams = new Set<TeamId>(STAGES.slice(0, maxIdx + 1).map((s) => s.owner));
  proj.subtasks.forEach((st) => teams.add(st.team));
  if (maxIdx >= STAGE_ORDER.indexOf("development")) teams.add("design");
  return teams;
}

/** Can this person even see this project?
 *  - Overseers (pmo/leadership): everything
 *  - Everyone on a team the project has ever involved: yes, lead or member alike —
 *    the database (RLS p_sel) has never distinguished role for visibility, only
 *    team; a client-only "members see personal items only" restriction here would
 *    just hide things the server would happily return, which is its own bug
 *  - Anyone personally named (raised it, owns it, or has a sub-task on it), even
 *    on an uninvolved team — covers e.g. a QA person given a Design sub-task */
export function visibleTo(me: Person, proj: Project): boolean {
  if (isOverseer(me)) return true;
  if (teamsInvolved(proj).has(me.team)) return true;
  if (proj.businessOwnerId === me.id || proj.ownerId === me.id) return true;
  if (proj.subtasks.some((s) => s.assigneeId === me.id)) return true;
  return false;
}

export function visibleProjects(me: Person, projects: Project[]): Project[] {
  return projects.filter((p) => visibleTo(me, p));
}

/** Every person id in `me`'s reporting subtree (including themself), walking
 *  `managerId` down from their own row. Mirrors the DB's my_subtree_ids()
 *  exactly — SECURITY DEFINER there, plain recursion here, same shape. Pure
 *  structure, no hardcoded names: add anyone under an SVP in `people` and
 *  their subtree/visibility updates with zero code changes. */
export function orgSubtreeIds(me: Person, all: Person[]): Set<string> {
  const byManager = new Map<string, string[]>();
  for (const p of all) {
    if (!p.managerId) continue;
    const list = byManager.get(p.managerId);
    if (list) list.push(p.id); else byManager.set(p.managerId, [p.id]);
  }
  const out = new Set<string>([me.id]);
  const queue = [me.id];
  while (queue.length) {
    const id = queue.pop()!;
    for (const childId of byManager.get(id) ?? []) {
      if (!out.has(childId)) { out.add(childId); queue.push(childId); }
    }
  }
  return out;
}

/** Org-hierarchy visibility: a project is visible if any person-reference on
 *  it — owner, business owner, tech lead, product SPOC, or any subtask
 *  assignee — falls in the subtree. Mirrors the DB's p_sel exactly. Applied
 *  additively on top of visibleTo() for everyone (see App.tsx's `base`), not
 *  gated by role or tier — for someone with no reports the subtree is just
 *  themself, which visibleTo already covers, so this only ever *adds*
 *  visibility for people who genuinely have descendants. */
export function subtreeVisibleTo(proj: Project, subtree: Set<string>): boolean {
  if (subtreeLeads(proj, subtree)) return true;
  return proj.subtasks.some((s) => s.assigneeId && subtree.has(s.assigneeId));
}

/** Narrower sibling of subtreeVisibleTo() — no subtask-assignee branch, only
 *  the four PRIMARY project references. Mirrors the DB's subtree_leads()
 *  exactly: a subtask is too light a connection to justify full-column edit
 *  rights (isMine()), only viewing/light actions (subtreeVisibleTo(), used
 *  by canHold/canAddAttachment, mirrors subtree_owns() and does include it). */
export function subtreeLeads(proj: Project, subtree: Set<string>): boolean {
  return [proj.ownerId, proj.businessOwnerId, proj.techLeadId, proj.productSpocId].some((id) => id && subtree.has(id));
}

/** Navigation is role-specific — contributors and overseers get different apps.
 *  Everyone gets a dashboard + all-projects table; overseers, global-view
 *  grantees, and anyone with org-hierarchy reports also get the board and
 *  escalations list. */
export function navFor(me: Person, all: Person[]): ViewKey[] {
  return hasOrgNav(me, all)
    ? ["overview", "board", "list", "escalations"]
    : ["overview", "queue", "team", "list"];
}

export function homeView(me: Person, all: Person[]): ViewKey {
  return hasOrgNav(me, all) ? "overview" : "queue";
}

/** An open (unresolved) leadership/PMO note pins a project to the top of attention. */
export const openLeadershipNote = (p: Project) => p.comments.some((c) => c.pinned && !c.resolved);
export const pinnedNotes = (p: Project) => p.comments.filter((c) => c.pinned);

export function can(action: Action, me: Person, proj?: Project): boolean {
  if (action === "comment") return true;            // everyone — incl. leadership — can leave notes
  if (isReadOnly(me)) return false;                 // leadership otherwise never writes
  if (action === "create") return ["business", "product", "tech_spoc"].includes(me.team) || me.role === "pmo";
  if (!proj) return me.role === "pmo";
  if (me.role === "pmo") return true;               // PMO is the process owner
  if (action === "pickup") {
    if (proj.stage !== "to_be_picked" || !["tech_spoc", "development"].includes(me.team)) return false;
    if (!hasCoarseTeamLeak(me, PEOPLE)) return true;
    // Manager-assign model: a coarse-team-leak actor may only pick up new
    // work for their OWN reports, and only if they actually have any on the
    // receiving team — self-serve pickup by an individual contributor is
    // off; mirrors the DB's is_manager() + subtree-has-tech_spoc/development
    // branch on p_upd exactly.
    if (!isManager(me, PEOPLE)) return false;
    const subtree = orgSubtreeIds(me, PEOPLE);
    return PEOPLE.some((p) => subtree.has(p.id) && (p.team === "tech_spoc" || p.team === "development"));
  }
  return isMine(me, proj);                           // otherwise: only the team in-court acts
}

/** Candidate pool for a "who exactly is this for" picker, for a transition
 *  landing on `team` out of `fromStage`. Ordinarily just everyone active on
 *  that team; for a coarse-team-leak manager assigning fresh to_be_picked
 *  work, narrows to their own reports on that team only — mirrors can()'s
 *  "pickup" gating so the picker never offers someone the write would reject. */
export function candidatesForTeam(me: Person, all: Person[], team: TeamId, fromStage: StageId): Person[] {
  const pool = all.filter((p) => p.team === team && p.active !== false);
  if (fromStage === "to_be_picked" && hasCoarseTeamLeak(me, all)) {
    const subtree = orgSubtreeIds(me, all);
    return pool.filter((p) => subtree.has(p.id));
  }
  return pool;
}

/** Whether `me` can act on a *specific* transition. Almost always just `can("advance"/"pickup")`,
 *  except marking something live: that's the deploying team's call, not PMO's — PMO directs the
 *  process everywhere else, but shouldn't be the one clicking "go live" on someone else's deploy. */
export function canPerformTransition(me: Person, proj: Project, spec: TransitionSpec): boolean {
  const isGoLive = proj.stage === "pre_prod" && spec.kind === "forward" && spec.to === "live";
  if (isGoLive) return isMine(me, proj);
  if (proj.stage === "to_be_picked" && spec.kind === "forward") return can("pickup", me, proj);
  return can("advance", me, proj);
}

/** Sub-tasks are created only by Product / Tech SPOC (they scope the work) —
 *  everyone else can still see and act on the sub-tasks assigned to them,
 *  just not author new ones. Mirrors the DB's s_ins policy. */
export function canCreateSubtask(me: Person): boolean {
  return me.role === "pmo" || me.team === "product" || me.team === "tech_spoc";
}

/** Who may set/edit a given STAGE's expected date — only the team that owns
 *  that specific stage (or PMO), and only once every earlier stage already
 *  has its own date set. Dates fill in sequentially, stage by stage, in
 *  pipeline order — never out of order, never by an unrelated team. Mirrors
 *  the DB's st_wr policy + trg_stage_target_order exactly. */
export function canEditStageTarget(me: Person, proj: Project, stage: StageId): boolean {
  if (isReadOnly(me)) return false;
  if (me.role !== "pmo" && STAGE_BY_ID[stage].owner !== me.team) return false;
  const idx = STAGE_ORDER.indexOf(stage);
  for (let i = 0; i < idx; i++) {
    if (!proj.stageTargets[STAGE_ORDER[i]]) return false;
  }
  return true;
}

/** May actually attach a document — mirrors the DB's a_ins exactly: in-court
 *  (or PMO), or your team is already part of the project's story. Narrower
 *  than commenting, which everyone (even read-only leadership) may do —
 *  visibility alone isn't enough to write here, unlike a comment. */
export function canAddAttachment(me: Person, proj: Project): boolean {
  if (isReadOnly(me)) return false;
  if (me.role === "pmo") return true;
  if (hasCoarseTeamLeak(me, PEOPLE)) {
    const subtree = orgSubtreeIds(me, PEOPLE);
    return subtreeVisibleTo(proj, subtree);
  }
  return ownerTeam(proj) === me.team || teamsInvolved(proj).has(me.team);
}

/** "Mark as Hold" — any team except Business, and only a team already
 *  part of the project's story (matches teamsInvolved, the client mirror of
 *  the DB's involved_teams). Leadership and SVPs are excluded even though
 *  their team name technically isn't "business" — both are pure read-only
 *  observers everywhere else in the app, and this shouldn't be the one
 *  exception. Mirrors the DB's corrected p_upd hold branch exactly. Same
 *  actor set governs removing hold — no distinct rule was specified. */
export function canHold(me: Person, proj: Project): boolean {
  if (me.role === "pmo") return true;
  if (me.role === "leadership" || me.role === "svp") return false;
  if (me.team === "business") return false;
  if (!hasCoarseTeamLeak(me, PEOPLE)) return teamsInvolved(proj).has(me.team);
  // Coarse-team-leak actors: same subtree-based reference check as p_upd's
  // hold branch, in place of the plain team-involvement check above.
  const subtree = orgSubtreeIds(me, PEOPLE);
  return subtreeVisibleTo(proj, subtree);
}
export const canUnhold = canHold;

/** Lead (or any member) of a team, to hand the ball to. Retired directory
 *  entries (active === false — a superseded hierarchy import, kept only for
 *  FK/history integrity) must never be picked as a new owner. */
export function leadOf(team: string): string {
  const pool = PEOPLE.filter((p) => p.active !== false);
  const lead = pool.find((p) => p.team === team && p.role === "lead");
  return (lead ?? pool.find((p) => p.team === team) ?? pool[0] ?? PEOPLE[0]).id;
}

/** Who owns the ball after a transition — the picker keeps dev pickups, else the target lead. */
export function ownerForTransition(spec: TransitionSpec, me: Person): string {
  if (spec.kind === "forward" && spec.to === "development" && me.team === "development") return me.id;
  return leadOf(spec.ownerTeam);
}
