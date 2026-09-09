// Unit tests for backend/authz.js and backend/projectScope.js — the two
// modules that ARE this app's authorization boundary (see backend/authz.js's
// header: this app has no Postgres RLS, unlike gyftr-ceo-portal's sibling —
// see DATABASE.md).
//
// Why this file is easy mode compared to gyftr-ceo-portal's equivalent
// (tests/logic.test.mjs there mirrors frontend rules, tests/security.test.mjs
// there hits a REAL database through RLS): every function under test here is
// a PURE function — plain objects in, a boolean/thrown-Error out, no
// database, no network. So there is no separate "does the server actually
// enforce this" integration layer to write; testing the function directly
// IS testing the enforcement, because the function is the enforcement.
//
// Coverage is intentionally proportionate to risk, per the migration brief:
// real confidence in the trickiest logic (hasCoarseTeamLeak, subtree_owns vs
// subtree_leads, enforceProjectUpdateScope's column restrictions), not
// exhaustive coverage of every branch. Scenarios below are the ones
// documented in supabase/schema.sql's comments and validated this session:
// SVP/hierarchy subtree access, Business can't hold, coarse-team-leak
// isolation, product-lead date-only edits outside their own court.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasCoarseTeamLeak, isHierarchyPerson, hasReports, orgSubtreeIds,
  subtreeOwns, subtreeLeads, canSee, canAct, canCreateProject,
  canCreateSubtask, canManageSubtask, canDeleteSubtask, canDispatchPickup,
  canInsertStageHistory, canAddAttachment, canResolveComment, isPmo, isOverseer,
} from '../backend/authz.js';
import { syncProjectScope, syncSubtaskScope, enforceProjectUpdateScope, enforceStageTargetOrder } from '../backend/projectScope.js';
import { stageOwner, STAGE_ORDER } from '../backend/workflow.js';

/* ── Fixtures ─────────────────────────────────────────────────────────────
 * A small org: Rajneesh (tech_spoc PMO, CTO) -> Anandita (tech_spoc lead,
 * hierarchy manager) -> Harshita (tech_spoc member) and Raj (development
 * member). Neha (business lead) -> Anjali (business member) is a separate
 * branch, used for the Business-hierarchy hold tests. Saurabh (product lead)
 * has no reports — an individual, not a manager.
 */
const rajneesh = { id: 'p_rajneesh', team: 'tech_spoc', role: 'pmo', manager_id: null };
const anandita = { id: 'p_anandita', team: 'tech_spoc', role: 'lead', manager_id: 'p_rajneesh' };
const harshita = { id: 'p_harshita', team: 'tech_spoc', role: 'member', manager_id: 'p_anandita' };
const raj       = { id: 'p_raj', team: 'development', role: 'member', manager_id: 'p_anandita' };
const neha      = { id: 'p_neha', team: 'business', role: 'lead', manager_id: null };
const anjali    = { id: 'p_anjali', team: 'business', role: 'member', manager_id: 'p_neha' };
const saurabh   = { id: 'p_saurabh', team: 'product', role: 'lead', manager_id: null };
const qaPerson  = { id: 'p_qa', team: 'qa', role: 'member', manager_id: null };
const leadership = { id: 'p_leadership', team: 'leadership', role: 'leadership', manager_id: null };

const ALL_PEOPLE = [rajneesh, anandita, harshita, raj, neha, anjali, saurabh, qaPerson, leadership];

/* ── orgSubtreeIds / hasReports / isHierarchyPerson ─────────────────────── */

test('orgSubtreeIds walks manager_id down to every descendant, including self', () => {
  const subtree = orgSubtreeIds(rajneesh, ALL_PEOPLE);
  assert.ok(subtree.has('p_rajneesh'), 'includes self');
  assert.ok(subtree.has('p_anandita'));
  assert.ok(subtree.has('p_harshita'), 'includes grandchild');
  assert.ok(subtree.has('p_raj'), 'includes grandchild on a different team');
  assert.ok(!subtree.has('p_neha'), 'excludes an unrelated branch');
  assert.equal(subtree.size, 4);
});

test('a leaf report has a subtree of just themselves', () => {
  const subtree = orgSubtreeIds(harshita, ALL_PEOPLE);
  assert.deepEqual([...subtree], ['p_harshita']);
});

test('hasReports / isHierarchyPerson: manager vs individual vs report', () => {
  assert.equal(hasReports(rajneesh, ALL_PEOPLE), true, 'rajneesh manages anandita');
  assert.equal(hasReports(saurabh, ALL_PEOPLE), false, 'saurabh has nobody under them');
  assert.equal(isHierarchyPerson(rajneesh, ALL_PEOPLE), true, 'has reports');
  assert.equal(isHierarchyPerson(harshita, ALL_PEOPLE), true, 'has a manager');
  assert.equal(isHierarchyPerson(saurabh, ALL_PEOPLE), false, 'neither manages nor is managed');
});

/* ── hasCoarseTeamLeak — the structural stand-in for "SVP-style" subtree
 * access: the current model applies orgSubtreeIds() to anyone in a
 * hierarchy-bearing team, rather than gating it on role='svp' (see
 * authz.js's isSvp() comment: dormant, kept only for schema parity).
 * The flagged set is development/qa/design/business — NOT tech_spoc, even
 * though tech_spoc is itself a manager-bearing team in this fixture; that
 * asymmetry is exactly the kind of thing worth locking in with a test. ──── */

test('hasCoarseTeamLeak is true only for hierarchy people on the four flagged teams', () => {
  assert.equal(hasCoarseTeamLeak(raj, ALL_PEOPLE), true, 'development is a flagged team, and raj has a manager');
  assert.equal(hasCoarseTeamLeak(neha, ALL_PEOPLE), true, 'business is a flagged team, and neha manages anjali');
  assert.equal(hasCoarseTeamLeak(rajneesh, ALL_PEOPLE), false, 'tech_spoc is NOT a flagged team, despite rajneesh managing people');
  assert.equal(hasCoarseTeamLeak(anandita, ALL_PEOPLE), false, 'tech_spoc is NOT flagged, even though anandita is both managed and a manager');
  assert.equal(hasCoarseTeamLeak(saurabh, ALL_PEOPLE), false, 'product is not a flagged team');
  assert.equal(hasCoarseTeamLeak(qaPerson, ALL_PEOPLE), false, 'qa IS flagged, but qaPerson is not in any hierarchy at all');
});

/* ── subtreeOwns vs subtreeLeads — the broad/narrow split ────────────────
 * subtreeLeads checks the four primary project references only.
 * subtreeOwns additionally counts a subtask assignee in the subtree. */

const projectLedByAnandita = {
  owner_id: 'p_anandita', business_owner_id: null, tech_lead_id: null, product_spoc_id: null,
  subtasks: [],
};
const projectWithOnlyASubtaskAssignee = {
  owner_id: null, business_owner_id: null, tech_lead_id: null, product_spoc_id: null,
  subtasks: [{ assignee_id: 'p_harshita' }],
};
const unrelatedProject = {
  owner_id: 'p_saurabh', business_owner_id: null, tech_lead_id: null, product_spoc_id: null,
  subtasks: [{ assignee_id: 'p_saurabh' }],
};

test('subtreeLeads: true only for the four primary reference columns', () => {
  const subtree = orgSubtreeIds(rajneesh, ALL_PEOPLE);
  assert.equal(subtreeLeads(projectLedByAnandita, subtree), true, 'owner_id is in the subtree');
  assert.equal(subtreeLeads(projectWithOnlyASubtaskAssignee, subtree), false,
    'a subtask assignee alone does not count for the narrow check');
  assert.equal(subtreeLeads(unrelatedProject, subtree), false);
});

test('subtreeOwns: also true via a subtask assignee (the broad OR-chain)', () => {
  const subtree = orgSubtreeIds(rajneesh, ALL_PEOPLE);
  assert.equal(subtreeOwns(projectLedByAnandita, subtree), true, 'inherits subtreeLeads');
  assert.equal(subtreeOwns(projectWithOnlyASubtaskAssignee, subtree), true,
    'a subtask assignee in the subtree is enough for the broad check');
  assert.equal(subtreeOwns(unrelatedProject, subtree), false);
});

/* ── canSee — visibility, including subtree-based hierarchy visibility ──── */

function project(overrides = {}) {
  return {
    owner_team: 'development', involved_teams: ['business', 'development'],
    stage: 'development', owner_id: null, business_owner_id: null,
    tech_lead_id: null, product_spoc_id: null, subtasks: [],
    ...overrides,
  };
}

test('canSee: overseer (PMO/leadership) sees everything', () => {
  assert.equal(canSee(rajneesh, project({ involved_teams: ['qa'] }), ALL_PEOPLE), true, 'pmo');
  assert.equal(canSee(leadership, project({ involved_teams: ['qa'] }), ALL_PEOPLE), true, 'leadership');
});

test('canSee: plain team involvement grants visibility when there is no coarse-team leak', () => {
  assert.equal(canSee(qaPerson, project({ involved_teams: ['qa'] }), ALL_PEOPLE), true);
  assert.equal(canSee(qaPerson, project({ involved_teams: ['development'] }), ALL_PEOPLE), false);
});

test('canSee: hierarchy visibility via subtree — a manager sees a project only their report leads', () => {
  // raj (development, reports to anandita, under rajneesh) leads a project;
  // the project is NOT involved_teams-tagged for tech_spoc, so only the
  // subtree path can grant rajneesh visibility.
  const p = project({ owner_team: 'development', involved_teams: ['business', 'development'], tech_lead_id: 'p_raj' });
  assert.equal(canSee(rajneesh, p, ALL_PEOPLE), true, 'rajneesh manages raj transitively — subtree visibility');
  assert.equal(canSee(saurabh, p, ALL_PEOPLE), false, 'saurabh has no team-involvement or subtree link');
});

test('canSee: to_be_picked stage is visible to anyone who can dispatch pickup', () => {
  const p = project({ stage: 'to_be_picked', involved_teams: ['tech_spoc'] });
  // anandita manages someone on tech_spoc/development (harshita, raj) and is a manager —
  // dispatch is judged by hierarchy (orgSubtreeIds), not by the actor's own team.
  assert.equal(canDispatchPickup(anandita, ALL_PEOPLE), true);
  assert.equal(canSee(anandita, p, ALL_PEOPLE), true, 'to_be_picked visibility via the dispatch path');
  // qaPerson is a lone individual (no reports, no manager) on an uninvolved
  // team — none of the visibility paths apply.
  assert.equal(canDispatchPickup(qaPerson, ALL_PEOPLE), false);
  assert.equal(canSee(qaPerson, p, ALL_PEOPLE), false,
    'without team involvement, subtree ownership, or dispatch rights, to_be_picked is not visible');
});

/* ── canAct / creation guards ─────────────────────────────────────────── */

test('canCreateProject: PMO or business/product/tech_spoc only', () => {
  assert.equal(canCreateProject(rajneesh), true, 'pmo');
  assert.equal(canCreateProject(neha), true, 'business');
  assert.equal(canCreateProject(saurabh), true, 'product');
  assert.equal(canCreateProject(anandita), true, 'tech_spoc');
  assert.equal(canCreateProject(raj), false, 'development cannot create');
  assert.equal(canCreateProject(qaPerson), false, 'qa cannot create');
});

test('canCreateSubtask / canDeleteSubtask: product + tech_spoc + PMO only', () => {
  for (const fn of [canCreateSubtask, canDeleteSubtask]) {
    assert.equal(fn(saurabh), true, 'product');
    assert.equal(fn(anandita), true, 'tech_spoc');
    assert.equal(fn(rajneesh), true, 'pmo');
    assert.equal(fn(raj), false, 'development cannot');
  }
});

test('canManageSubtask: the actor set, PLUS the assignee acting on their own row', () => {
  const subtask = { assignee_id: 'p_raj' };
  assert.equal(canManageSubtask(saurabh, subtask), true, 'product manages any subtask');
  assert.equal(canManageSubtask(anandita, subtask), true, 'tech_spoc manages any subtask');
  assert.equal(canManageSubtask(raj, subtask), true, 'the assignee may update their own row');
  assert.equal(canManageSubtask(qaPerson, subtask), false, 'not the assignee, not product/tech_spoc/pmo');
});

/* ── Business-hierarchy hold carve-out — enforceProjectUpdateScope ───────
 * "Business can't hold": a Business-team hierarchy manager gets full
 * subtree-leads control of their own branch's work EXCEPT the hold columns.
 */

function baseProject(overrides = {}) {
  return {
    stage: 'intake', status: 'Scoping', owner_team: 'business',
    involved_teams: ['business'],
    owner_id: 'p_anjali', business_owner_id: 'p_anjali', tech_lead_id: null, product_spoc_id: null,
    title: 'Original title', on_hold: false, hold_reason: null, held_by_id: null, held_by_team: null, held_at: null,
    subtasks: [],
    ...overrides,
  };
}

test('Business-hierarchy manager may edit their own branch\'s project, but not touch hold columns', () => {
  const old = baseProject();
  // neha manages anjali (owner_id) — subtreeLeads holds.
  assert.doesNotThrow(() => enforceProjectUpdateScope(neha, ALL_PEOPLE, old, { title: 'New title' }),
    'ordinary field edit is allowed');
  assert.throws(
    () => enforceProjectUpdateScope(neha, ALL_PEOPLE, old, { on_hold: true, hold_reason: 'blocked upstream' }),
    /Business may not change hold status/,
    'Business cannot set hold columns even within their own branch'
  );
});

test('PMO bypasses every restriction, including hold columns', () => {
  const old = baseProject();
  assert.doesNotThrow(() => enforceProjectUpdateScope(rajneesh, ALL_PEOPLE, old, { on_hold: true, hold_reason: 'x' }));
});

/* ── Product-lead date-only carve-out outside their own court ───────────── */

test('a Product lead outside their own court may only touch target_go_live / timeline_eta', () => {
  const productLead = { id: 'p_prodlead', team: 'product', role: 'lead', manager_id: null };
  const old = baseProject({ owner_team: 'development', involved_teams: ['business', 'development'] });

  assert.doesNotThrow(
    () => enforceProjectUpdateScope(productLead, [...ALL_PEOPLE, productLead], old, { target_go_live: '2026-12-01' }),
    'date fields are allowed'
  );
  assert.doesNotThrow(
    () => enforceProjectUpdateScope(productLead, [...ALL_PEOPLE, productLead], old, { timeline_eta: '2026-12-15' }),
    'timeline_eta is also allowed'
  );
  assert.throws(
    () => enforceProjectUpdateScope(productLead, [...ALL_PEOPLE, productLead], old, { title: 'Renamed' }),
    /Product leads may only edit go-live dates/,
    'anything else outside their own court is refused'
  );
});

test('a Product MEMBER (not lead) outside their court falls to the generic hold-only carve-out', () => {
  const productMember = { id: 'p_prodmember', team: 'product', role: 'member', manager_id: null };
  const old = baseProject({ owner_team: 'development', involved_teams: ['business', 'product', 'development'] });
  assert.throws(
    () => enforceProjectUpdateScope(productMember, [...ALL_PEOPLE, productMember], old, { title: 'x' }),
    /Only hold-related fields may be changed/
  );
  assert.doesNotThrow(
    () => enforceProjectUpdateScope(productMember, [...ALL_PEOPLE, productMember], old, { on_hold: true, hold_reason: 'r' })
  );
});

test('a completely unconnected non-business actor is refused outright', () => {
  const old = baseProject({ owner_team: 'development', involved_teams: ['business', 'development'] });
  assert.throws(
    () => enforceProjectUpdateScope(qaPerson, ALL_PEOPLE, old, { title: 'x' }),
    /insufficient_privilege/
  );
});

test('a no-op patch (no fields actually change) is always allowed, even for an unrelated actor', () => {
  const old = baseProject({ owner_team: 'development', involved_teams: ['business', 'development'] });
  assert.doesNotThrow(() => enforceProjectUpdateScope(qaPerson, ALL_PEOPLE, old, { title: old.title }));
});

/* ── syncProjectScope / syncSubtaskScope ─────────────────────────────────── */

test('syncProjectScope recomputes owner_team from the new stage and folds in business + the actor\'s team', () => {
  const result = syncProjectScope({ stage: 'intake', involved_teams: ['business'], final_go_live: null }, { stage: 'to_be_picked' }, 'product');
  assert.equal(result.owner_team, stageOwner('to_be_picked'));
  assert.ok(result.involved_teams.includes('business'));
  assert.ok(result.involved_teams.includes('tech_spoc'), 'the new owning team');
  assert.ok(result.involved_teams.includes('product'), 'the acting team, even though it doesn\'t own the new stage');
  assert.equal(result.final_go_live, null);
});

test('syncProjectScope stamps final_go_live exactly once, on reaching live', () => {
  const result = syncProjectScope({ stage: 'pre_prod', involved_teams: ['business'], final_go_live: null }, { stage: 'live' }, 'development');
  assert.ok(result.final_go_live, 'stamped on the transition to live');
  const already = syncProjectScope({ stage: 'live', involved_teams: ['business'], final_go_live: '2026-01-01' }, { stage: 'live' }, 'development');
  assert.equal(already.final_go_live, '2026-01-01', 'not restamped once already set');
});

test('syncSubtaskScope adds a new team, and returns null when already present (no write needed)', () => {
  const added = syncSubtaskScope({ involved_teams: ['business', 'product'] }, 'qa');
  assert.deepEqual(added, ['business', 'product', 'qa']);
  const unchanged = syncSubtaskScope({ involved_teams: ['business', 'qa'] }, 'qa');
  assert.equal(unchanged, null);
});

/* ── enforceStageTargetOrder ─────────────────────────────────────────────── */

test('enforceStageTargetOrder: refuses setting a later stage\'s date before an earlier one is set', () => {
  assert.throws(
    () => enforceStageTargetOrder([], 'development', '2026-05-01'),
    /Set intake expected date before development|Set scoping expected date before development/
  );
});

test('enforceStageTargetOrder: allows a date on/after all prior stages\' dates', () => {
  const priorStages = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf('development'))
    .map((stage) => ({ stage, expected_date: '2026-01-01' }));
  assert.doesNotThrow(() => enforceStageTargetOrder(priorStages, 'development', '2026-02-01'));
  assert.throws(() => enforceStageTargetOrder(priorStages, 'development', '2025-12-01'),
    /on or after the previous stage's date/);
});

test('enforceStageTargetOrder: clearing a date (null) is always allowed', () => {
  assert.doesNotThrow(() => enforceStageTargetOrder([], 'live', null));
});

/* ── canInsertStageHistory / canAddAttachment / canResolveComment ────────── */

test('canInsertStageHistory: coarse-team-leak actors need subtreeLeads, not just team involvement', () => {
  // raj is on a leak-flagged team (development) and reports to anandita —
  // hasCoarseTeamLeak(raj) is true, so the plain "my team is involved"
  // branch never fires for him; only subtreeLeads decides.
  const p = project({ owner_team: 'development', involved_teams: ['business', 'development'], tech_lead_id: 'p_raj' });
  assert.equal(canInsertStageHistory(raj, p, ALL_PEOPLE), true, 'subtree leads via raj himself as tech_lead_id');
  const pNoLink = project({ owner_team: 'development', involved_teams: ['business', 'development'] });
  assert.equal(canInsertStageHistory(raj, pNoLink, ALL_PEOPLE), false,
    'plain team-involvement is not enough once hasCoarseTeamLeak is true — needs subtreeLeads');
  // Contrast: qaPerson has no coarse-team leak, so plain team involvement is sufficient.
  const pQa = project({ owner_team: 'development', involved_teams: ['business', 'qa'] });
  assert.equal(canInsertStageHistory(qaPerson, pQa, ALL_PEOPLE), true, 'no leak — team involvement alone is enough');
});

test('canAddAttachment: broader than canAct — team involvement alone is enough absent a leak', () => {
  const p = project({ owner_team: 'development', involved_teams: ['business', 'qa'] });
  assert.equal(canAddAttachment(qaPerson, p, ALL_PEOPLE), true, 'qa is involved, no leak on qa team');
  assert.equal(canAddAttachment(saurabh, p, ALL_PEOPLE), false, 'product is not involved and not in court');
});

test('canResolveComment: the author may always resolve their own comment, even off-court', () => {
  const p = project({ owner_team: 'development', involved_teams: ['business', 'development'] });
  const comment = { by_id: 'p_saurabh' };
  assert.equal(canResolveComment(saurabh, p, comment, ALL_PEOPLE), true, 'author, even though off-court');
  assert.equal(canResolveComment(qaPerson, p, comment, ALL_PEOPLE), false, 'neither author nor in-court');
});

test('isOverseer / isPmo sanity', () => {
  assert.equal(isPmo(rajneesh), true);
  assert.equal(isOverseer(rajneesh), true);
  assert.equal(isOverseer(leadership), true);
  assert.equal(isPmo(leadership), false, 'leadership is an overseer but not PMO');
});
