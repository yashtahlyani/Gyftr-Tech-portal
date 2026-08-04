/* ─── Server-side mirror of src/workflow.ts's STATUSES/TRANSITIONS — just
   enough to validate a transition/status request is actually legal, instead
   of trusting whatever the client sends. Keep in sync with workflow.ts by
   hand; it changes rarely (it's the org's process, not app config). ─── */

const STATUS_META = {
  business_clarification:     { kind: "blocked", stage: "intake" },
  scoping:                    { kind: "active",  stage: "scoping" },
  to_be_picked:                { kind: "active",  stage: "to_be_picked" },
  dev:                         { kind: "active",  stage: "development" },
  ready_to_test:               { kind: "active",  stage: "qa" },
  qa:                          { kind: "active",  stage: "qa" },
  need_bug_fixing:             { kind: "active",  stage: "development" },
  bug_fixing_initiated:        { kind: "active",  stage: "development" },
  tech_clarification_pending:  { kind: "blocked", stage: "development" },
  qa_clarification_pending:    { kind: "blocked", stage: "qa" },
  uat:                          { kind: "active",  stage: "uat" },
  pending_prod_deployment:     { kind: "active",  stage: "pre_prod" },
  live:                         { kind: "done",    stage: "live" },
  business_dependency:         { kind: "blocked", stage: "intake" },
  partner_dependency:          { kind: "blocked", stage: "scoping" },
  on_hold:                      { kind: "blocked", stage: "development" },
  deferred:                     { kind: "blocked", stage: "development" },
};

const TRANSITIONS = {
  intake: [
    { to: "scoping", toStatus: "scoping", ownerTeam: "product", kind: "forward" },
  ],
  scoping: [
    { to: "to_be_picked", toStatus: "to_be_picked", ownerTeam: "tech_spoc", kind: "forward" },
    { to: "intake", toStatus: "business_clarification", ownerTeam: "business", kind: "back" },
  ],
  to_be_picked: [
    { to: "development", toStatus: "dev", ownerTeam: "development", kind: "forward" },
    { to: "scoping", toStatus: "scoping", ownerTeam: "product", kind: "back" },
  ],
  development: [
    { to: "qa", toStatus: "qa", ownerTeam: "qa", kind: "forward" },
    { to: "scoping", toStatus: "tech_clarification_pending", ownerTeam: "product", kind: "back" },
  ],
  qa: [
    { to: "uat", toStatus: "uat", ownerTeam: "product", kind: "forward" },
    { to: "development", toStatus: "need_bug_fixing", ownerTeam: "development", kind: "reject" },
  ],
  uat: [
    { to: "pre_prod", toStatus: "pending_prod_deployment", ownerTeam: "development", kind: "forward" },
    { to: "development", toStatus: "need_bug_fixing", ownerTeam: "development", kind: "reject" },
  ],
  pre_prod: [
    { to: "live", toStatus: "live", ownerTeam: "leadership", kind: "forward" },
    { to: "development", toStatus: "need_bug_fixing", ownerTeam: "development", kind: "reject" },
  ],
  live: [
    { to: "development", toStatus: "need_bug_fixing", ownerTeam: "development", kind: "reopen" },
  ],
};

function findTransition(fromStage, toStage) {
  return (TRANSITIONS[fromStage] || []).find((t) => t.to === toStage);
}

module.exports = { STATUS_META, TRANSITIONS, findTransition };
