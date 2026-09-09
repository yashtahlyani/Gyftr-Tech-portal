/* ─── Cloud store — reads/writes the backend/ Express API (RDS Postgres
   behind it), polling for updates. Used when isCloud is true (see lib.ts).
   Same exported surface as localStore.ts; store.ts picks between the two.
   Route-level guards in backend/authz.js enforce who can write what — this
   file just shapes the requests and mirrors state optimistically so the UI
   feels instant while the write is in flight.

   Realtime trade-off: Supabase Realtime (postgres_changes) had no self-hosted
   AWS equivalent without extra infra (e.g. a WebSocket fanout service), so
   this polls GET /api/projects every ~7s instead. Documented, deliberate —
   see the migration plan. ─── */
import { useEffect, useState } from "react";
import type { Project, StageId, StatusId, Comment, SubTask, HistoryEntry, Attachment, DocKind } from "./types";
import { isCloud } from "./lib";
import { onAuthEvent } from "./auth";
import * as api from "./api";
import type { Row } from "./api";
import { STATUSES } from "./workflow";
import { toast } from "./toast";

/** Every optimistic write funnels its failure through here: tell the user,
 *  then refetch so the UI snaps back to server truth instead of lying. */
function writeFailed(what: string, message: string) {
  console.error(`${what}:`, message);
  toast(`${what} — the change was rolled back. (${message})`);
  fetchAll();
}

function mapSubtask(r: Row): SubTask {
  return {
    id: r.id, title: r.title, team: r.team, assigneeId: r.assignee_id ?? undefined, done: r.done,
    createdAt: Date.parse(r.created_at),
    expectedDate: r.expected_date ?? undefined,
    promisedDate: r.promised_date ?? undefined,
    effortDays: r.effort_days ?? undefined,
  };
}
function mapHistory(r: Row): HistoryEntry {
  return { id: r.id, at: Date.parse(r.at), byId: r.by_id, fromStage: r.from_stage, toStage: r.to_stage, fromStatus: r.from_status, toStatus: r.to_status, note: r.note ?? undefined };
}
function mapComment(r: Row): Comment {
  return { id: r.id, at: Date.parse(r.at), byId: r.by_id, text: r.text, pinned: r.pinned, resolved: r.resolved };
}
function mapAttachment(r: Row): Attachment {
  return { id: r.id, name: r.name, kind: r.kind as DocKind, url: r.url ?? undefined, byId: r.by_id, at: Date.parse(r.at) };
}
function mapStageTargets(rows: Row[]): Partial<Record<StageId, string>> {
  const out: Partial<Record<StageId, string>> = {};
  for (const r of rows) out[r.stage as StageId] = r.expected_date;
  return out;
}
function mapProject(r: Row): Project {
  return {
    id: r.id, code: r.code, title: r.title, brd: r.brd ?? "", partner: r.partner, brand: r.brand ?? null, lob: r.lob ?? "",
    priority: r.priority, bifurcation: r.bifurcation ?? "B2C",
    stage: r.stage, status: r.status, ownerId: r.owner_id, businessOwnerId: r.business_owner_id,
    blocked: r.blocked, blockReason: r.block_reason ?? undefined,
    onHold: r.on_hold ?? false, holdReason: r.hold_reason ?? undefined,
    heldById: r.held_by_id ?? undefined, heldByTeam: r.held_by_team ?? undefined,
    heldAt: r.held_at ? Date.parse(r.held_at) : undefined,
    stageEnteredAt: Date.parse(r.stage_entered_at), createdAt: Date.parse(r.created_at),
    targetGoLive: r.target_go_live, sacrosanctGoLive: r.sacrosanct_go_live,
    priorityMonth: r.priority_month, timelineEta: r.timeline_eta, devEffortDays: r.dev_effort_days,
    reasonForDelay: r.reason_for_delay, productSpocId: r.product_spoc_id, techLeadId: r.tech_lead_id,
    finalGoLive: r.final_go_live,
    subtasks: (r.subtasks ?? []).map(mapSubtask).sort((a: SubTask, b: SubTask) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    history: (r.stage_history ?? []).map(mapHistory).sort((a: HistoryEntry, b: HistoryEntry) => a.at - b.at),
    comments: (r.comments ?? []).map(mapComment).sort((a: Comment, b: Comment) => a.at - b.at),
    attachments: (r.attachments ?? []).map(mapAttachment).sort((a: Attachment, b: Attachment) => a.at - b.at),
    stageTargets: mapStageTargets(r.stage_targets ?? []),
  };
}

let state: Project[] = [];
const listeners = new Set<() => void>();
function notify() { listeners.forEach((l) => l()); }
function findProject(id: string): Project | undefined { return state.find((p) => p.id === id); }
function localPatch(id: string, patch: Partial<Project>) {
  state = state.map((p) => (p.id === id ? { ...p, ...patch } : p));
  notify();
}
/** Replace one project's row with the server's returned nested project —
 *  the standard success path for the single PATCH /api/projects/:id
 *  endpoint that now backs every mutation below. */
function replaceProject(row: Row) {
  const proj = mapProject(row);
  state = state.map((p) => (p.id === proj.id ? proj : p));
  notify();
}

async function fetchAll() {
  if (!isCloud) return;
  try {
    const rows = await api.fetchProjects();
    state = rows.map(mapProject);
    notify();
  } catch (err) {
    console.error("Failed to load projects:", (err as Error).message);
  }
}

let pollHandle: ReturnType<typeof setInterval> | null = null;
const POLL_MS = 7_000;

let started = false;
function ensureStarted() {
  if (started || !isCloud) return;
  started = true;
  fetchAll();

  // No AWS realtime equivalent without extra infra (see file header) — poll
  // instead. Only runs while at least one component is mounted/listening;
  // see stopPollIfIdle() below.
  pollHandle = setInterval(fetchAll, POLL_MS);

  // A profile switch (sign-out then sign-in as someone else) means a
  // different Cognito identity and a different server-side visibility slice.
  // Without this, `started` above means fetchAll() never runs again and the
  // board stays stuck on whatever the previous person could see.
  onAuthEvent((e) => {
    if (e.type === "signed_in") fetchAll();
    else if (e.type === "signed_out") { state = []; notify(); }
  });
}

export function useProjects(): Project[] {
  const [, force] = useState(0);
  useEffect(() => {
    ensureStarted();
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return state;
}

async function patchProject(id: string, patch: Row, note?: string) {
  if (!isCloud) return;
  try {
    const row = await api.patchProjectRow(id, note !== undefined ? { ...patch, note } : patch);
    replaceProject(row);
  } catch (err) {
    writeFailed("Couldn't save that change", (err as Error).message);
  }
}

/* ── Actions — mirror localStore.ts's signatures exactly ── */

export function moveToStage(id: string, toStage: StageId, byId: string, note?: string) {
  // Kept for API parity with localStore; the app always calls transition()/pickUp() in cloud mode.
  void id; void toStage; void byId; void note;
}

export function transition(id: string, byId: string, spec: { to: StageId; toStatus: StatusId; label: string }, newOwnerId: string) {
  const p = findProject(id); if (!p) return;
  void byId; // the server stamps by_id from the authenticated caller, not a client-supplied value
  const blocked = STATUSES[spec.toStatus].kind === "blocked";
  const stageEnteredAt = Date.now();
  const finalGoLive = spec.to === "live" && !p.finalGoLive ? new Date().toISOString().slice(0, 10) : p.finalGoLive;
  localPatch(id, { stage: spec.to, status: spec.toStatus, ownerId: newOwnerId, blocked, blockReason: blocked ? p.blockReason : undefined, stageEnteredAt, finalGoLive });
  patchProject(id, { stage: spec.to, status: spec.toStatus, owner_id: newOwnerId, blocked, block_reason: blocked ? p.blockReason ?? null : null, stage_entered_at: new Date(stageEnteredAt).toISOString() }, spec.label);
}

/** Sheet-parity planning fields — editable from the project page's Details rail. */
export type DetailsPatch = Partial<Pick<Project,
  "priorityMonth" | "timelineEta" | "devEffortDays" | "reasonForDelay" |
  "productSpocId" | "techLeadId" | "targetGoLive" | "sacrosanctGoLive" | "brand">>;

export function updateDetails(id: string, patch: DetailsPatch) {
  localPatch(id, patch);
  const row: Row = {};
  if ("priorityMonth" in patch) row.priority_month = patch.priorityMonth ?? null;
  if ("timelineEta" in patch) row.timeline_eta = patch.timelineEta ?? null;
  if ("devEffortDays" in patch) row.dev_effort_days = patch.devEffortDays ?? null;
  if ("reasonForDelay" in patch) row.reason_for_delay = patch.reasonForDelay ?? null;
  if ("productSpocId" in patch) row.product_spoc_id = patch.productSpocId ?? null;
  if ("techLeadId" in patch) row.tech_lead_id = patch.techLeadId ?? null;
  if ("targetGoLive" in patch) row.target_go_live = patch.targetGoLive ?? null;
  if ("sacrosanctGoLive" in patch) row.sacrosanct_go_live = patch.sacrosanctGoLive ?? null;
  if ("brand" in patch) row.brand = patch.brand ?? null;
  patchProject(id, row);
}

/** Per-stage expected date, upserted (one row per project+stage). */
export function setStageTarget(id: string, stage: StageId, byId: string, expectedDate: string | null) {
  const p = findProject(id); if (!p) return;
  void byId; // server stamps updated_by from the authenticated caller
  localPatch(id, { stageTargets: { ...p.stageTargets, [stage]: expectedDate ?? undefined } });
  if (!isCloud) return;
  api.putStageTargetRow(id, stage, expectedDate).catch((err) => {
    writeFailed("Stage date didn't save", (err as Error).message);
  });
}

export function setStatus(id: string, toStatus: StatusId, byId: string) {
  const p = findProject(id); if (!p || p.status === toStatus) return;
  void byId;
  const meta = STATUSES[toStatus];
  const stageChanged = meta.stage !== p.stage && meta.kind !== "blocked";
  const stageEnteredAt = stageChanged ? Date.now() : p.stageEnteredAt;
  const toStage = stageChanged ? meta.stage : p.stage;
  localPatch(id, { status: toStatus, stage: toStage, blocked: meta.kind === "blocked", stageEnteredAt });
  patchProject(id, { status: toStatus, stage: toStage, blocked: meta.kind === "blocked", stage_entered_at: new Date(stageEnteredAt).toISOString() });
}

export function reassign(id: string, ownerId: string) {
  localPatch(id, { ownerId });
  patchProject(id, { owner_id: ownerId });
}

export function pickUp(id: string, byId: string) {
  const p = findProject(id); if (!p || p.stage !== "to_be_picked") return;
  void byId;
  const stageEnteredAt = Date.now();
  localPatch(id, { stage: "development", status: "dev", ownerId: byId, blocked: false, stageEnteredAt });
  patchProject(id, { stage: "development", status: "dev", owner_id: byId, blocked: false, stage_entered_at: new Date(stageEnteredAt).toISOString() }, "Picked up");
}

export function requestClarification(id: string, byId: string, toStage: StageId, toStatus: StatusId, note: string, newOwnerId: string) {
  const p = findProject(id); if (!p) return;
  void byId;
  const stageEnteredAt = Date.now();
  localPatch(id, { stage: toStage, status: toStatus, ownerId: newOwnerId, blocked: true, blockReason: note, stageEnteredAt });
  patchProject(id, { stage: toStage, status: toStatus, owner_id: newOwnerId, blocked: true, block_reason: note, stage_entered_at: new Date(stageEnteredAt).toISOString() }, `Clarification requested: ${note}`);
}

export function reopen(id: string, byId: string, note: string, devOwnerId: string) {
  const p = findProject(id); if (!p) return;
  void byId;
  const stageEnteredAt = Date.now();
  localPatch(id, { stage: "development", status: "need_bug_fixing", ownerId: devOwnerId, blocked: false, stageEnteredAt });
  patchProject(id, { stage: "development", status: "need_bug_fixing", owner_id: devOwnerId, blocked: false, stage_entered_at: new Date(stageEnteredAt).toISOString() }, `Reopened: ${note}`);
}

export function setBlock(id: string, blocked: boolean, reason?: string) {
  localPatch(id, { blocked, blockReason: blocked ? reason : undefined });
  patchProject(id, { blocked, block_reason: blocked ? reason ?? null : null });
}

/** "Mark as Hold" — an explicit pause, separate from setBlock/blocked (see
 *  types.ts). Stage/status are untouched; un-holding (onHold=false) just
 *  clears the hold fields and the project resumes wherever it already was. */
export function setHold(id: string, onHold: boolean, reason: string | undefined, byId: string, byTeam: import("./types").TeamId) {
  const heldAt = Date.now();
  localPatch(id, {
    onHold, holdReason: onHold ? reason : undefined,
    heldById: onHold ? byId : undefined, heldByTeam: onHold ? byTeam : undefined,
    heldAt: onHold ? heldAt : undefined,
  });
  patchProject(id, {
    on_hold: onHold, hold_reason: onHold ? reason ?? null : null,
    held_by_id: onHold ? byId : null, held_by_team: onHold ? byTeam : null,
    held_at: onHold ? new Date(heldAt).toISOString() : null,
  });
}

export function addComment(id: string, byId: string, text: string, pinned = false) {
  if (!isCloud) return;
  void byId; // server stamps by_id from the authenticated caller
  const tempId = `tmp_${Date.now()}`;
  const c: Comment = { id: tempId, at: Date.now(), byId, text, pinned };
  const p = findProject(id);
  if (p) localPatch(id, { comments: [...p.comments, c] });
  api.createCommentRow(id, text, pinned).then(() => fetchAll()).catch((err) => {
    writeFailed("Comment didn't post", (err as Error).message);
  });
}

export function resolveNote(id: string, commentId: string) {
  const p = findProject(id);
  if (p) localPatch(id, { comments: p.comments.map((c) => (c.id === commentId ? { ...c, resolved: true } : c)) });
  if (!isCloud) return;
  api.patchCommentRow(commentId, true).catch((err) => {
    writeFailed("Couldn't resolve the note", (err as Error).message);
  });
}

export function addAttachment(id: string, byId: string, name: string, kind: DocKind, url?: string) {
  if (!isCloud) return;
  void byId; // server stamps by_id from the authenticated caller
  api.createAttachmentRow(id, name, kind, url).then(() => fetchAll()).catch((err) => {
    writeFailed("Document didn't attach", (err as Error).message);
  });
}

export function toggleSubtask(id: string, subId: string) {
  const p = findProject(id); if (!p) return;
  const sub = p.subtasks.find((s) => s.id === subId); if (!sub) return;
  localPatch(id, { subtasks: p.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)) });
  if (!isCloud) return;
  api.patchSubtaskRow(subId, { done: !sub.done }).catch((err) => {
    writeFailed("Sub-task didn't update", (err as Error).message);
  });
}

export function addSubtask(id: string, sub: Omit<SubTask, "id">) {
  if (!isCloud) return;
  api.createSubtaskRow(id, {
    title: sub.title, team: sub.team, assigneeId: sub.assigneeId ?? null, done: sub.done,
    expectedDate: sub.expectedDate ?? null,
  }).then(() => fetchAll()).catch((err) => {
    writeFailed("Sub-task didn't save", (err as Error).message);
  });
}

export type SubtaskPatch = Partial<Pick<SubTask, "promisedDate" | "effortDays" | "expectedDate">>;

export function updateSubtask(id: string, subId: string, patch: SubtaskPatch) {
  const p = findProject(id); if (!p) return;
  localPatch(id, { subtasks: p.subtasks.map((s) => (s.id === subId ? { ...s, ...patch } : s)) });
  if (!isCloud) return;
  const row: Row = {};
  if ("promisedDate" in patch) row.promised_date = patch.promisedDate ?? null;
  if ("effortDays" in patch) row.effort_days = patch.effortDays ?? null;
  if ("expectedDate" in patch) row.expected_date = patch.expectedDate ?? null;
  api.patchSubtaskRow(subId, row).catch((err) => {
    writeFailed("Sub-task update failed", (err as Error).message);
  });
}

export function removeSubtask(id: string, subId: string) {
  const p = findProject(id); if (!p) return;
  localPatch(id, { subtasks: p.subtasks.filter((s) => s.id !== subId) });
  if (!isCloud) return;
  api.deleteSubtaskRow(subId).catch((err) => {
    writeFailed("Sub-task didn't delete", (err as Error).message);
  });
}

export function reassignSubtask(id: string, subId: string, assigneeId: string | undefined) {
  const p = findProject(id); if (!p) return;
  localPatch(id, { subtasks: p.subtasks.map((s) => (s.id === subId ? { ...s, assigneeId } : s)) });
  if (!isCloud) return;
  api.patchSubtaskRow(subId, { assignee_id: assigneeId ?? null }).catch((err) => {
    writeFailed("Sub-task didn't reassign", (err as Error).message);
  });
}

export async function createProject(
  input: Omit<Project, "id" | "code" | "createdAt" | "stageEnteredAt" | "finalGoLive" | "history" | "comments" | "subtasks" | "attachments" | "stageTargets" | "onHold" | "holdReason" | "heldById" | "heldByTeam" | "heldAt"> & { subtasks?: SubTask[] }
): Promise<Project> {
  if (!isCloud) throw new Error("Cloud mode is off.");
  const row = await api.createProjectRow({
    title: input.title, brd: input.brd, partner: input.partner, brand: input.brand, lob: input.lob,
    priority: input.priority, bifurcation: input.bifurcation, stage: input.stage, status: input.status,
    owner_id: input.ownerId, business_owner_id: input.businessOwnerId,
    blocked: input.blocked, block_reason: input.blockReason ?? null,
    target_go_live: input.targetGoLive, sacrosanct_go_live: input.sacrosanctGoLive,
    priority_month: input.priorityMonth, timeline_eta: input.timelineEta,
    dev_effort_days: input.devEffortDays, reason_for_delay: input.reasonForDelay,
    product_spoc_id: input.productSpocId, tech_lead_id: input.techLeadId,
    subtasks: (input.subtasks ?? []).map((s) => ({ title: s.title, team: s.team, assigneeId: s.assigneeId ?? null, done: s.done })),
  });
  const proj = mapProject(row);
  state = [proj, ...state];
  notify();
  return proj;
}

export function resetDemo() {
  console.warn("resetDemo is a no-op in cloud mode — this would wipe shared production data.");
}
