/* ─── Row (snake_case) → API shape (camelCase), matching the exact field
   names src/cloudStore.ts's mapProject/mapSubtask/etc. already produced, so
   the frontend's Project/SubTask/etc. types don't need to change at all. ─── */

function subtask(r) {
  return {
    id: r.id, title: r.title, team: r.team, assigneeId: r.assignee_id ?? undefined, done: r.done,
    createdAt: r.created_at ? Date.parse(r.created_at) : undefined,
    expectedDate: r.expected_date ?? undefined,
    promisedDate: r.promised_date ?? undefined,
    effortDays: r.effort_days ?? undefined,
  };
}
function history(r) {
  return { id: r.id, at: Date.parse(r.at), byId: r.by_id, fromStage: r.from_stage, toStage: r.to_stage, fromStatus: r.from_status, toStatus: r.to_status, note: r.note ?? undefined };
}
function comment(r) {
  return { id: r.id, at: Date.parse(r.at), byId: r.by_id, text: r.text, pinned: r.pinned, resolved: r.resolved };
}
function attachment(r) {
  return { id: r.id, name: r.name, kind: r.kind, url: r.url ?? undefined, byId: r.by_id, at: Date.parse(r.at) };
}
function stageTargets(rows) {
  const out = {};
  for (const r of rows) out[r.stage] = r.expected_date;
  return out;
}
function person(r) {
  return { id: r.id, name: r.name, team: r.team, role: r.role, email: r.email };
}

/** `p` is a projects row; `children` holds its related rows already fetched. */
function project(p, children = {}) {
  return {
    id: p.id, code: p.code, title: p.title, brd: p.brd ?? "", partner: p.partner, brand: p.brand ?? null, lob: p.lob ?? "",
    priority: p.priority, bifurcation: p.bifurcation ?? "B2C",
    stage: p.stage, status: p.status, ownerId: p.owner_id, businessOwnerId: p.business_owner_id,
    blocked: p.blocked, blockReason: p.block_reason ?? undefined,
    stageEnteredAt: Date.parse(p.stage_entered_at), createdAt: Date.parse(p.created_at),
    targetGoLive: p.target_go_live, sacrosanctGoLive: p.sacrosanct_go_live,
    priorityMonth: p.priority_month, timelineEta: p.timeline_eta, devEffortDays: p.dev_effort_days,
    reasonForDelay: p.reason_for_delay, productSpocId: p.product_spoc_id, techLeadId: p.tech_lead_id,
    finalGoLive: p.final_go_live,
    involvedTeams: p.involved_teams ?? [], // used server-side for authz; harmless to also send to the client
    subtasks: (children.subtasks ?? []).map(subtask).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    history: (children.history ?? []).map(history).sort((a, b) => a.at - b.at),
    comments: (children.comments ?? []).map(comment).sort((a, b) => a.at - b.at),
    attachments: (children.attachments ?? []).map(attachment).sort((a, b) => a.at - b.at),
    stageTargets: stageTargets(children.stageTargets ?? []),
  };
}

module.exports = { subtask, history, comment, attachment, stageTargets, person, project };
