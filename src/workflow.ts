/* ─── The workflow model: stages, statuses, teams, SLAs, transitions ─── */
import type { StageId, StatusId, TeamId } from "./types";

export interface TeamMeta { id: TeamId; label: string; short: string; color: string; }

export const TEAMS: Record<TeamId, TeamMeta> = {
  business:    { id: "business",    label: "Business",     short: "BIZ", color: "#0EA5E9" },
  product:     { id: "product",     label: "Product",      short: "PRD", color: "#8B5CF6" },
  tech_spoc:   { id: "tech_spoc",   label: "Tech SPOC",    short: "SPOC", color: "#6366F1" },
  development: { id: "development",  label: "Development",  short: "DEV", color: "#F59E0B" },
  design:      { id: "design",      label: "Design / HTML", short: "DSGN", color: "#EC4899" },
  qa:          { id: "qa",          label: "QA",           short: "QA", color: "#10B981" },
  partner:     { id: "partner",     label: "Partner",      short: "PTNR", color: "#64748B" },
  leadership:  { id: "leadership",  label: "Leadership",   short: "LEAD", color: "#0F172A" },
};

export interface StageMeta {
  id: StageId;
  label: string;
  owner: TeamId;      // team that holds the ball in this lane
  slaDays: number;    // expected max days in this lane before it's "aging"
  defaultStatus: StatusId;
  color: string;
}

/** Ordered pipeline — this is the board, left → right. */
export const STAGES: StageMeta[] = [
  { id: "intake",        label: "Business Intake", owner: "business",    slaDays: 3,  defaultStatus: "business_clarification", color: "#8A93A8" },
  { id: "scoping",       label: "Product Scoping", owner: "product",     slaDays: 5,  defaultStatus: "scoping",                color: "#5B7FB0" },
  { id: "to_be_picked",  label: "To Be Picked",    owner: "tech_spoc",   slaDays: 3,  defaultStatus: "to_be_picked",           color: "#7C8896" },
  { id: "development",   label: "Development",     owner: "development", slaDays: 12, defaultStatus: "dev",                    color: "#C79A3E" },
  { id: "qa",            label: "QA",              owner: "qa",          slaDays: 5,  defaultStatus: "qa",                     color: "#2E9E86" },
  { id: "uat",           label: "UAT",             owner: "product",     slaDays: 4,  defaultStatus: "uat",                    color: "#6FA23C" },
  { id: "pre_prod",      label: "Pending Deploy",  owner: "development", slaDays: 2,  defaultStatus: "pending_prod_deployment", color: "#4C8A1E" },
  { id: "live",          label: "Live",            owner: "leadership",  slaDays: 999, defaultStatus: "live",                  color: "#62A92A" },
];

export const STAGE_BY_ID: Record<StageId, StageMeta> =
  Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<StageId, StageMeta>;

export const STAGE_ORDER: StageId[] = STAGES.map((s) => s.id);

/* ── The state machine: the ONLY moves allowed out of each stage ── */
export type TransitionKind = "forward" | "back" | "reject" | "reopen";
export interface TransitionSpec {
  to: StageId;
  label: string;         // human action, e.g. "Send to QA"
  toStatus: StatusId;
  ownerTeam: TeamId;     // team the ball is handed to
  kind: TransitionKind;
}

export const TRANSITIONS: Record<StageId, TransitionSpec[]> = {
  intake: [
    { to: "scoping", label: "Submit to Product", toStatus: "scoping", ownerTeam: "product", kind: "forward" },
  ],
  scoping: [
    { to: "to_be_picked", label: "Send to Tech Manager", toStatus: "to_be_picked", ownerTeam: "tech_spoc", kind: "forward" },
    { to: "intake", label: "Send back to Business", toStatus: "business_clarification", ownerTeam: "business", kind: "back" },
  ],
  to_be_picked: [
    { to: "development", label: "Pick up → Development", toStatus: "dev", ownerTeam: "development", kind: "forward" },
    { to: "scoping", label: "Return to Product", toStatus: "scoping", ownerTeam: "product", kind: "back" },
  ],
  development: [
    { to: "qa", label: "Send to QA", toStatus: "qa", ownerTeam: "qa", kind: "forward" },
    { to: "scoping", label: "Ask Product (clarify)", toStatus: "tech_clarification_pending", ownerTeam: "product", kind: "back" },
  ],
  qa: [
    { to: "uat", label: "Pass to UAT", toStatus: "uat", ownerTeam: "product", kind: "forward" },
    { to: "development", label: "Reject to Dev (bug)", toStatus: "need_bug_fixing", ownerTeam: "development", kind: "reject" },
  ],
  uat: [
    { to: "pre_prod", label: "Approve for deploy", toStatus: "pending_prod_deployment", ownerTeam: "development", kind: "forward" },
    { to: "development", label: "Reject to Dev", toStatus: "need_bug_fixing", ownerTeam: "development", kind: "reject" },
  ],
  pre_prod: [
    { to: "live", label: "Mark Live", toStatus: "live", ownerTeam: "leadership", kind: "forward" },
    { to: "development", label: "Rollback to Dev", toStatus: "need_bug_fixing", ownerTeam: "development", kind: "reject" },
  ],
  live: [
    { to: "development", label: "Reopen (bug found)", toStatus: "need_bug_fixing", ownerTeam: "development", kind: "reopen" },
  ],
};

export const forwardOf = (s: StageId) => TRANSITIONS[s].find((t) => t.kind === "forward");
export const transitionBetween = (from: StageId, to: StageId) => TRANSITIONS[from].find((t) => t.to === to);

export type StatusKind = "active" | "blocked" | "done";

export interface StatusMeta {
  id: StatusId;
  label: string;
  kind: StatusKind;
  stage: StageId;      // which lane this status naturally belongs to
  bg: string;
  fg: string;
}

const ROSE  = { bg: "var(--rose-bg)",  fg: "var(--rose-fg)"  };
const AMBER = { bg: "var(--amber-bg)", fg: "var(--amber-fg)" };
const BLUE  = { bg: "var(--blue-bg)",  fg: "var(--blue-fg)"  };
const TEAL  = { bg: "var(--teal-bg)",  fg: "var(--teal-fg)"  };
const OLIVE = { bg: "var(--olive-bg)", fg: "var(--olive-fg)" };
const GREEN = { bg: "var(--green-bg)", fg: "var(--green-fg)" };
const SLATE = { bg: "var(--slate-bg)", fg: "var(--slate-fg)" };

export const STATUSES: Record<StatusId, StatusMeta> = {
  business_clarification:     { id: "business_clarification",     label: "Business Clarification",     kind: "blocked", stage: "intake",       ...ROSE },
  scoping:                    { id: "scoping",                    label: "Scoping",                    kind: "active",  stage: "scoping",      ...BLUE },
  to_be_picked:               { id: "to_be_picked",               label: "To Be Picked",               kind: "active",  stage: "to_be_picked", ...SLATE },
  dev:                        { id: "dev",                        label: "In Development",             kind: "active",  stage: "development",  ...AMBER },
  ready_to_test:              { id: "ready_to_test",              label: "Ready to Test",              kind: "active",  stage: "qa",           ...TEAL },
  qa:                         { id: "qa",                         label: "In QA",                      kind: "active",  stage: "qa",           ...TEAL },
  need_bug_fixing:            { id: "need_bug_fixing",            label: "Need Bug Fixing",            kind: "active",  stage: "development",  ...ROSE },
  bug_fixing_initiated:       { id: "bug_fixing_initiated",       label: "Bug Fixing Initiated",       kind: "active",  stage: "development",  ...AMBER },
  tech_clarification_pending: { id: "tech_clarification_pending", label: "Tech Clarification Pending", kind: "blocked", stage: "development",  ...ROSE },
  qa_clarification_pending:   { id: "qa_clarification_pending",   label: "QA Clarification Pending",   kind: "blocked", stage: "qa",           ...ROSE },
  uat:                        { id: "uat",                        label: "UAT",                        kind: "active",  stage: "uat",          ...OLIVE },
  pending_prod_deployment:    { id: "pending_prod_deployment",    label: "Pending Prod Deployment",    kind: "active",  stage: "pre_prod",     ...BLUE },
  live:                       { id: "live",                       label: "Live",                       kind: "done",    stage: "live",         ...GREEN },
  business_dependency:        { id: "business_dependency",        label: "Business Dependency",        kind: "blocked", stage: "intake",       ...ROSE },
  partner_dependency:         { id: "partner_dependency",         label: "Partner Dependency",         kind: "blocked", stage: "scoping",      ...ROSE },
  on_hold:                    { id: "on_hold",                    label: "On Hold",                    kind: "blocked", stage: "development",  ...SLATE },
  deferred:                   { id: "deferred",                   label: "Deferred / Out of Scope",    kind: "blocked", stage: "development",  ...SLATE },
};

export const STATUS_LIST = Object.values(STATUSES);

/** Statuses selectable while a project is parked in a given stage. */
export function statusesForStage(stage: StageId): StatusMeta[] {
  const own = STATUS_LIST.filter((s) => s.stage === stage);
  const universalBlocks = ["on_hold", "business_dependency", "partner_dependency", "deferred"] as StatusId[];
  const extra = universalBlocks
    .map((id) => STATUSES[id])
    .filter((s) => !own.some((o) => o.id === s.id));
  return [...own, ...extra];
}

export const PRIORITY_META: Record<string, { bg: string; fg: string; rank: number }> = {
  P0: { bg: "var(--rose-bg)",  fg: "var(--rose-fg)",  rank: 3 },
  P1: { bg: "var(--amber-bg)", fg: "var(--amber-fg)", rank: 2 },
  P2: { bg: "var(--slate-bg)", fg: "var(--slate-fg)", rank: 1 },
};

/** Aging severity for a project sitting `days` in a stage with `slaDays` budget. */
export function aging(days: number, slaDays: number): "ok" | "warn" | "breach" {
  if (days > slaDays) return "breach";
  if (days > slaDays * 0.6) return "warn";
  return "ok";
}
