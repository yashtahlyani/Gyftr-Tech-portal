// workflow.js — server-side slice of src/workflow.ts's pipeline model:
// just the parts authz.js/projectScope.js/routes need (which team owns the
// ball per stage, and pipeline order for stage_targets sequencing). The
// full stage/status metadata (labels, colors, SLA days, transition specs)
// stays client-only in frontend/src/workflow.ts — the backend only needs
// to reproduce what used to be enforced by the DB (stage_owner() SQL
// function + the stage_id enum's declared order).

/** Mirrors supabase/schema.sql's stage_owner(s stage_id) function exactly.
 *  UAT is owned by Product (not Business) — go-live/deploy approval sits
 *  with Product per the CEO's process. pm_review ("Send to Project
 *  Manager") is also owned by Product — there's no separate "Project
 *  Manager" team, Product plays that role in this app's process. */
export const STAGE_OWNER = {
  intake: 'business',
  scoping: 'product',
  to_be_picked: 'tech_spoc',
  development: 'development',
  pm_review: 'product',
  qa: 'qa',
  uat: 'product',
  pre_prod: 'development',
  live: 'leadership',
};

export const stageOwner = (stage) => STAGE_OWNER[stage] ?? 'leadership';

/** Mirrors the stage_id enum's declared order — that order IS pipeline
 *  order everywhere (stage_targets sequencing, etc). Keep in sync with
 *  frontend/src/workflow.ts's STAGE_ORDER and backend/schema.sql's enum. */
export const STAGE_ORDER = [
  'intake', 'scoping', 'to_be_picked', 'development', 'pm_review',
  'qa', 'uat', 'pre_prod', 'live',
];
