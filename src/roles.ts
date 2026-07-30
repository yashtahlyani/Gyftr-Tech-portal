/* ─── Roles, visibility scoping & permissions ─── */
import type { Person, Project, TeamId, ViewKey } from "./types";
import { STAGES, STAGE_ORDER, STAGE_BY_ID, type TransitionSpec } from "./workflow";
import { PEOPLE } from "./people";

export type Action =
  | "create" | "pickup" | "advance" | "status" | "block"
  | "clarify" | "reopen" | "assign" | "comment" | "subtask";

export const isOverseer = (p: Person) => p.role === "pmo" || p.role === "leadership";
/** Leadership is a pure read-only observer — full visibility, zero edits. */
export const isReadOnly = (p: Person) => p.role === "leadership";

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

/** Navigation is role-specific — contributors and overseers get different apps.
 *  Everyone gets a dashboard + all-projects table; overseers also get
 *  the org-wide board and escalations list. */
export function navFor(me: Person): ViewKey[] {
  return isOverseer(me)
    ? ["overview", "board", "list", "escalations"]
    : ["overview", "queue", "team", "list"];
}

export function homeView(me: Person): ViewKey {
  return isOverseer(me) ? "overview" : "queue";
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
  if (action === "pickup")
    return proj.stage === "to_be_picked" && ["tech_spoc", "development"].includes(me.team);
  return isMine(me, proj);                           // otherwise: only the team in-court acts
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

/** Who may set/edit a stage's expected date — any team that's ever been
 *  involved with the project (not just whoever's currently in court), so
 *  e.g. Business can pencil in an expected QA-done date ahead of time.
 *  Mirrors the DB's st_wr policy. Leadership never writes, per usual. */
export function canEditStageTarget(me: Person, proj: Project): boolean {
  if (isReadOnly(me)) return false;
  return me.role === "pmo" || teamsInvolved(proj).has(me.team);
}

/** Lead (or any member) of a team, to hand the ball to. */
export function leadOf(team: string): string {
  const lead = PEOPLE.find((p) => p.team === team && p.role === "lead");
  return (lead ?? PEOPLE.find((p) => p.team === team) ?? PEOPLE[0]).id;
}

/** Who owns the ball after a transition — the picker keeps dev pickups, else the target lead. */
export function ownerForTransition(spec: TransitionSpec, me: Person): string {
  if (spec.kind === "forward" && spec.to === "development" && me.team === "development") return me.id;
  return leadOf(spec.ownerTeam);
}
