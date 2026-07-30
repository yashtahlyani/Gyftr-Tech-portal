/* ─── Cloud store — reads/writes the live Supabase project, realtime-synced.
   Used when VITE_SUPABASE_* is set. Same exported surface as localStore.ts;
   store.ts picks between the two. RLS on the server enforces who can write
   what — this file just shapes the requests and mirrors state optimistically
   so the UI feels instant while the write is in flight. ─── */
import { useEffect, useState } from "react";
import type { Project, StageId, StatusId, Comment, SubTask, HistoryEntry, Attachment, DocKind } from "./types";
import { supabase } from "./lib";
import { STATUSES } from "./workflow";
import { toast } from "./toast";

/** Every optimistic write funnels its failure through here: tell the user,
 *  then refetch so the UI snaps back to server truth instead of lying. */
function writeFailed(what: string, message: string) {
  console.error(`${what}:`, message);
  toast(`${what} — the change was rolled back. (${message})`);
  fetchAll();
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const SELECT = "*, subtasks(*), stage_history(*), comments(*), attachments(*), stage_targets(*)";

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

async function fetchAll() {
  if (!supabase) return;
  const { data, error } = await supabase.from("projects").select(SELECT).order("created_at", { ascending: false });
  if (error) { console.error("Failed to load projects:", error.message); return; }
  state = (data ?? []).map(mapProject);
  notify();
}

let started = false;
function ensureStarted() {
  if (started || !supabase) return;
  started = true;
  fetchAll();
  const client = supabase;
  client
    .channel("projects-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => fetchAll())
    .on("postgres_changes", { event: "*", schema: "public", table: "subtasks" }, () => fetchAll())
    .on("postgres_changes", { event: "*", schema: "public", table: "stage_history" }, () => fetchAll())
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, () => fetchAll())
    .on("postgres_changes", { event: "*", schema: "public", table: "attachments" }, () => fetchAll())
    .subscribe();

  // Every profile switch is a real sign-out + sign-in (different auth.uid(), different
  // RLS-visible rows). Without this, `started` above means fetchAll() never runs again
  // and the board stays stuck on whatever the previous person could see until a hard reload.
  client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") fetchAll();
    else if (event === "SIGNED_OUT") { state = []; notify(); }
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

async function patchProject(id: string, patch: Row) {
  if (!supabase) return;
  const { error } = await supabase.from("projects").update(patch).eq("id", id);
  if (error) writeFailed("Couldn't save that change", error.message);
}
async function insertHistory(projectId: string, byId: string, fromStage: StageId | null, toStage: StageId, fromStatus: StatusId | null, toStatus: StatusId, note?: string) {
  if (!supabase) return;
  const { error } = await supabase.from("stage_history").insert({
    project_id: projectId, by_id: byId, from_stage: fromStage, to_stage: toStage, from_status: fromStatus, to_status: toStatus, note,
  });
  if (error) console.error("History insert failed:", error.message); // history is best-effort; the move itself already saved
}

/* ── Actions — mirror localStore.ts's signatures exactly ── */

export function moveToStage(id: string, toStage: StageId, byId: string, note?: string) {
  // Kept for API parity with localStore; the app always calls transition()/pickUp() in cloud mode.
  void id; void toStage; void byId; void note;
}

export function transition(id: string, byId: string, spec: { to: StageId; toStatus: StatusId; label: string }, newOwnerId: string) {
  const p = findProject(id); if (!p) return;
  const blocked = STATUSES[spec.toStatus].kind === "blocked";
  const stageEnteredAt = Date.now();
  // final_go_live is stamped by the DB trigger; mirror it optimistically
  const finalGoLive = spec.to === "live" && !p.finalGoLive ? new Date().toISOString().slice(0, 10) : p.finalGoLive;
  localPatch(id, { stage: spec.to, status: spec.toStatus, ownerId: newOwnerId, blocked, blockReason: blocked ? p.blockReason : undefined, stageEnteredAt, finalGoLive });
  patchProject(id, { stage: spec.to, status: spec.toStatus, owner_id: newOwnerId, blocked, block_reason: blocked ? p.blockReason ?? null : null, stage_entered_at: new Date(stageEnteredAt).toISOString() });
  insertHistory(id, byId, p.stage, spec.to, p.status, spec.toStatus, spec.label);
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
  localPatch(id, { stageTargets: { ...p.stageTargets, [stage]: expectedDate ?? undefined } });
  if (!supabase) return;
  supabase.from("stage_targets")
    .upsert({ project_id: id, stage, expected_date: expectedDate, updated_by: byId, updated_at: new Date().toISOString() }, { onConflict: "project_id,stage" })
    .then(({ error }) => {
      if (error) writeFailed("Stage date didn't save", error.message);
    });
}

export function setStatus(id: string, toStatus: StatusId, byId: string) {
  const p = findProject(id); if (!p || p.status === toStatus) return;
  const meta = STATUSES[toStatus];
  const stageChanged = meta.stage !== p.stage && meta.kind !== "blocked";
  const stageEnteredAt = stageChanged ? Date.now() : p.stageEnteredAt;
  const toStage = stageChanged ? meta.stage : p.stage;
  localPatch(id, { status: toStatus, stage: toStage, blocked: meta.kind === "blocked", stageEnteredAt });
  patchProject(id, { status: toStatus, stage: toStage, blocked: meta.kind === "blocked", stage_entered_at: new Date(stageEnteredAt).toISOString() });
  insertHistory(id, byId, p.stage, toStage, p.status, toStatus);
}

export function reassign(id: string, ownerId: string) {
  localPatch(id, { ownerId });
  patchProject(id, { owner_id: ownerId });
}

export function pickUp(id: string, byId: string) {
  const p = findProject(id); if (!p || p.stage !== "to_be_picked") return;
  const stageEnteredAt = Date.now();
  localPatch(id, { stage: "development", status: "dev", ownerId: byId, blocked: false, stageEnteredAt });
  patchProject(id, { stage: "development", status: "dev", owner_id: byId, blocked: false, stage_entered_at: new Date(stageEnteredAt).toISOString() });
  insertHistory(id, byId, p.stage, "development", p.status, "dev", "Picked up");
}

export function requestClarification(id: string, byId: string, toStage: StageId, toStatus: StatusId, note: string, newOwnerId: string) {
  const p = findProject(id); if (!p) return;
  const stageEnteredAt = Date.now();
  localPatch(id, { stage: toStage, status: toStatus, ownerId: newOwnerId, blocked: true, blockReason: note, stageEnteredAt });
  patchProject(id, { stage: toStage, status: toStatus, owner_id: newOwnerId, blocked: true, block_reason: note, stage_entered_at: new Date(stageEnteredAt).toISOString() });
  insertHistory(id, byId, p.stage, toStage, p.status, toStatus, `Clarification requested: ${note}`);
}

export function reopen(id: string, byId: string, note: string, devOwnerId: string) {
  const p = findProject(id); if (!p) return;
  const stageEnteredAt = Date.now();
  localPatch(id, { stage: "development", status: "need_bug_fixing", ownerId: devOwnerId, blocked: false, stageEnteredAt });
  patchProject(id, { stage: "development", status: "need_bug_fixing", owner_id: devOwnerId, blocked: false, stage_entered_at: new Date(stageEnteredAt).toISOString() });
  insertHistory(id, byId, p.stage, "development", p.status, "need_bug_fixing", `Reopened: ${note}`);
}

export function setBlock(id: string, blocked: boolean, reason?: string) {
  localPatch(id, { blocked, blockReason: blocked ? reason : undefined });
  patchProject(id, { blocked, block_reason: blocked ? reason ?? null : null });
}

export function addComment(id: string, byId: string, text: string, pinned = false) {
  if (!supabase) return;
  const tempId = `tmp_${Date.now()}`;
  const c: Comment = { id: tempId, at: Date.now(), byId, text, pinned };
  const p = findProject(id);
  if (p) localPatch(id, { comments: [...p.comments, c] });
  supabase.from("comments").insert({ project_id: id, by_id: byId, text, pinned }).then(({ error }) => {
    if (error) writeFailed("Comment didn't post", error.message); else fetchAll();
  });
}

export function resolveNote(id: string, commentId: string) {
  const p = findProject(id);
  if (p) localPatch(id, { comments: p.comments.map((c) => (c.id === commentId ? { ...c, resolved: true } : c)) });
  if (!supabase) return;
  supabase.from("comments").update({ resolved: true }).eq("id", commentId).then(({ error }) => {
    if (error) writeFailed("Couldn't resolve the note", error.message);
  });
}

export function addAttachment(id: string, byId: string, name: string, kind: DocKind, url?: string) {
  if (!supabase) return;
  supabase.from("attachments").insert({ project_id: id, by_id: byId, name, kind, url }).then(({ error }) => {
    if (error) writeFailed("Document didn't attach", error.message); else fetchAll();
  });
}

export function toggleSubtask(id: string, subId: string) {
  const p = findProject(id); if (!p) return;
  const sub = p.subtasks.find((s) => s.id === subId); if (!sub) return;
  localPatch(id, { subtasks: p.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)) });
  if (!supabase) return;
  supabase.from("subtasks").update({ done: !sub.done }).eq("id", subId).then(({ error }) => {
    if (error) writeFailed("Sub-task didn't update", error.message);
  });
}

export function addSubtask(id: string, sub: Omit<SubTask, "id">) {
  if (!supabase) return;
  supabase.from("subtasks").insert({
    project_id: id, title: sub.title, team: sub.team, assignee_id: sub.assigneeId ?? null, done: sub.done,
    expected_date: sub.expectedDate ?? null,
  }).then(({ error }) => {
    if (error) writeFailed("Sub-task didn't save", error.message); else fetchAll();
  });
}

export type SubtaskPatch = Partial<Pick<SubTask, "promisedDate" | "effortDays" | "expectedDate">>;

export function updateSubtask(id: string, subId: string, patch: SubtaskPatch) {
  const p = findProject(id); if (!p) return;
  localPatch(id, { subtasks: p.subtasks.map((s) => (s.id === subId ? { ...s, ...patch } : s)) });
  if (!supabase) return;
  const row: Row = {};
  if ("promisedDate" in patch) row.promised_date = patch.promisedDate ?? null;
  if ("effortDays" in patch) row.effort_days = patch.effortDays ?? null;
  if ("expectedDate" in patch) row.expected_date = patch.expectedDate ?? null;
  supabase.from("subtasks").update(row).eq("id", subId).then(({ error }) => {
    if (error) writeFailed("Sub-task update failed", error.message);
  });
}

export function removeSubtask(id: string, subId: string) {
  const p = findProject(id); if (!p) return;
  localPatch(id, { subtasks: p.subtasks.filter((s) => s.id !== subId) });
  if (!supabase) return;
  supabase.from("subtasks").delete().eq("id", subId).then(({ error }) => {
    if (error) writeFailed("Sub-task didn't delete", error.message);
  });
}

export function reassignSubtask(id: string, subId: string, assigneeId: string | undefined) {
  const p = findProject(id); if (!p) return;
  localPatch(id, { subtasks: p.subtasks.map((s) => (s.id === subId ? { ...s, assigneeId } : s)) });
  if (!supabase) return;
  supabase.from("subtasks").update({ assignee_id: assigneeId ?? null }).eq("id", subId).then(({ error }) => {
    if (error) writeFailed("Sub-task didn't reassign", error.message);
  });
}

export async function createProject(
  input: Omit<Project, "id" | "code" | "createdAt" | "stageEnteredAt" | "finalGoLive" | "history" | "comments" | "subtasks" | "attachments" | "stageTargets"> & { subtasks?: SubTask[] }
): Promise<Project> {
  if (!supabase) throw new Error("Cloud mode is off.");
  const { data, error } = await supabase
    .from("projects")
    .insert({
      title: input.title, brd: input.brd, partner: input.partner, brand: input.brand, lob: input.lob,
      priority: input.priority, bifurcation: input.bifurcation, stage: input.stage, status: input.status,
      owner_id: input.ownerId, business_owner_id: input.businessOwnerId,
      blocked: input.blocked, block_reason: input.blockReason ?? null,
      target_go_live: input.targetGoLive, sacrosanct_go_live: input.sacrosanctGoLive,
      priority_month: input.priorityMonth, timeline_eta: input.timelineEta,
      dev_effort_days: input.devEffortDays, reason_for_delay: input.reasonForDelay,
      product_spoc_id: input.productSpocId, tech_lead_id: input.techLeadId,
    })
    .select(SELECT)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Create failed");
  const proj = mapProject(data);
  if (input.subtasks?.length) {
    await supabase.from("subtasks").insert(input.subtasks.map((s) => ({ project_id: proj.id, title: s.title, team: s.team, assignee_id: s.assigneeId ?? null, done: s.done })));
  }
  await insertHistory(proj.id, input.businessOwnerId, null, input.stage, null, input.status, "Project created");
  await fetchAll();
  return findProject(proj.id) ?? proj;
}

export function resetDemo() {
  console.warn("resetDemo is a no-op in cloud mode — this would wipe shared production data.");
}
