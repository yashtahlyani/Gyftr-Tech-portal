/* ─── Cloud store — reads/writes the AWS API, polling-synced. Used when
   VITE_API_URL is set. Same exported surface as localStore.ts; store.ts
   picks between the two. Authorization is enforced entirely server-side now
   (backend/authz.js) — this file just shapes requests and mirrors state
   optimistically so the UI feels instant while the write is in flight.

   Realtime went away with Supabase; a project list this size polls fine —
   every open tab refetches every ~7s, plus immediately after any local
   write and right after sign-in/out. ─── */
import { useEffect, useState } from "react";
import type { Project, StageId, StatusId, SubTask, DocKind } from "./types";
import { get, post, patch as httpPatch, put, del, ApiError } from "./api";
import { subscribeAuthChanged } from "./auth";
import { toast } from "./toast";

const POLL_MS = 7000;

/** Every optimistic write funnels its failure through here: tell the user,
 *  then refetch so the UI snaps back to server truth instead of lying. */
function writeFailed(what: string, message: string) {
  console.error(`${what}:`, message);
  toast(`${what} — the change was rolled back. (${message})`);
  fetchAll();
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
  try {
    state = await get<Project[]>("/api/projects");
    notify();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return; // not signed in yet
    console.error("Failed to load projects:", err);
  }
}

let started = false;
function ensureStarted() {
  if (started) return;
  started = true;
  fetchAll();
  const interval = setInterval(fetchAll, POLL_MS);
  subscribeAuthChanged(fetchAll);
  void interval; // lives for the app's lifetime, same as the old Realtime channel
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

/* ── Actions — mirror localStore.ts's signatures exactly ── */

export function moveToStage(id: string, toStage: StageId, byId: string, note?: string) {
  // Kept for API parity with localStore; the app always calls transition()/pickUp() in cloud mode.
  void id; void toStage; void byId; void note;
}

export function transition(id: string, byId: string, spec: { to: StageId; toStatus: StatusId; label: string }, newOwnerId: string) {
  const p = findProject(id); if (!p) return;
  localPatch(id, { stage: spec.to, status: spec.toStatus, ownerId: newOwnerId });
  post<Project>(`/api/projects/${id}/transition`, { toStage: spec.to, ownerId: newOwnerId, note: spec.label })
    .then((proj) => localPatch(id, proj))
    .catch((err) => writeFailed("Couldn't move the project", err.message));
}

export type DetailsPatch = Partial<Pick<Project,
  "priorityMonth" | "timelineEta" | "devEffortDays" | "reasonForDelay" |
  "productSpocId" | "techLeadId" | "targetGoLive" | "sacrosanctGoLive" | "brand">>;

export function updateDetails(id: string, patch: DetailsPatch) {
  localPatch(id, patch);
  httpPatch<Project>(`/api/projects/${id}/details`, patch)
    .then((proj) => localPatch(id, proj))
    .catch((err) => writeFailed("Couldn't save that change", err.message));
}

/** Per-stage expected date, upserted (one row per project+stage). */
export function setStageTarget(id: string, stage: StageId, byId: string, expectedDate: string | null) {
  const p = findProject(id); if (!p) return;
  void byId;
  localPatch(id, { stageTargets: { ...p.stageTargets, [stage]: expectedDate ?? undefined } });
  put<Project["stageTargets"]>(`/api/stage-targets/${id}/${stage}`, { expectedDate })
    .then((stageTargets) => localPatch(id, { stageTargets }))
    .catch((err) => writeFailed("Stage date didn't save", err.message));
}

export function setStatus(id: string, toStatus: StatusId, byId: string) {
  const p = findProject(id); if (!p || p.status === toStatus) return;
  void byId;
  localPatch(id, { status: toStatus });
  post<Project>(`/api/projects/${id}/status`, { toStatus })
    .then((proj) => localPatch(id, proj))
    .catch((err) => writeFailed("Couldn't update status", err.message));
}

export function reassign(id: string, ownerId: string) {
  localPatch(id, { ownerId });
  post<Project>(`/api/projects/${id}/reassign`, { ownerId })
    .then((proj) => localPatch(id, proj))
    .catch((err) => writeFailed("Couldn't reassign", err.message));
}

export function pickUp(id: string, byId: string) {
  const p = findProject(id); if (!p || p.stage !== "to_be_picked") return;
  localPatch(id, { stage: "development", status: "dev", ownerId: byId, blocked: false });
  post<Project>(`/api/projects/${id}/pickup`)
    .then((proj) => localPatch(id, proj))
    .catch((err) => writeFailed("Couldn't pick this up", err.message));
}

export function requestClarification(id: string, byId: string, toStage: StageId, toStatus: StatusId, note: string, newOwnerId: string) {
  const p = findProject(id); if (!p) return;
  void byId;
  localPatch(id, { stage: toStage, status: toStatus, ownerId: newOwnerId, blocked: true, blockReason: note });
  post<Project>(`/api/projects/${id}/clarify`, { toStage, toStatus, note, ownerId: newOwnerId })
    .then((proj) => localPatch(id, proj))
    .catch((err) => writeFailed("Couldn't request clarification", err.message));
}

export function reopen(id: string, byId: string, note: string, devOwnerId: string) {
  const p = findProject(id); if (!p) return;
  void byId;
  localPatch(id, { stage: "development", status: "need_bug_fixing", ownerId: devOwnerId, blocked: false });
  post<Project>(`/api/projects/${id}/reopen`, { note, ownerId: devOwnerId })
    .then((proj) => localPatch(id, proj))
    .catch((err) => writeFailed("Couldn't reopen", err.message));
}

export function setBlock(id: string, blocked: boolean, reason?: string) {
  localPatch(id, { blocked, blockReason: blocked ? reason : undefined });
  post<Project>(`/api/projects/${id}/block`, { blocked, reason })
    .then((proj) => localPatch(id, proj))
    .catch((err) => writeFailed("Couldn't update the block", err.message));
}

export function addComment(id: string, byId: string, text: string, pinned = false) {
  const tempId = `tmp_${Date.now()}`;
  const p = findProject(id);
  if (p) localPatch(id, { comments: [...p.comments, { id: tempId, at: Date.now(), byId, text, pinned }] });
  post(`/api/comments`, { projectId: id, text, pinned })
    .then(fetchAll)
    .catch((err: ApiError) => writeFailed("Comment didn't post", err.message));
}

export function resolveNote(id: string, commentId: string) {
  const p = findProject(id);
  if (p) localPatch(id, { comments: p.comments.map((c) => (c.id === commentId ? { ...c, resolved: true } : c)) });
  post(`/api/comments/${commentId}/resolve`)
    .catch((err: ApiError) => writeFailed("Couldn't resolve the note", err.message));
}

export function addAttachment(id: string, byId: string, name: string, kind: DocKind, url?: string) {
  void byId;
  post(`/api/attachments`, { projectId: id, name, kind, url })
    .then(fetchAll)
    .catch((err: ApiError) => writeFailed("Document didn't attach", err.message));
}

export function toggleSubtask(id: string, subId: string) {
  const p = findProject(id); if (!p) return;
  const sub = p.subtasks.find((s) => s.id === subId); if (!sub) return;
  localPatch(id, { subtasks: p.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)) });
  post(`/api/subtasks/${subId}/toggle`)
    .catch((err: ApiError) => writeFailed("Sub-task didn't update", err.message));
}

export function addSubtask(id: string, sub: Omit<SubTask, "id">) {
  post(`/api/subtasks`, {
    projectId: id, title: sub.title, team: sub.team, assigneeId: sub.assigneeId ?? null, done: sub.done,
    expectedDate: sub.expectedDate ?? null,
  })
    .then(fetchAll)
    .catch((err: ApiError) => writeFailed("Sub-task didn't save", err.message));
}

export type SubtaskPatch = Partial<Pick<SubTask, "promisedDate" | "effortDays" | "expectedDate">>;

export function updateSubtask(id: string, subId: string, patch: SubtaskPatch) {
  const p = findProject(id); if (!p) return;
  localPatch(id, { subtasks: p.subtasks.map((s) => (s.id === subId ? { ...s, ...patch } : s)) });
  httpPatch(`/api/subtasks/${subId}`, patch)
    .catch((err: ApiError) => writeFailed("Sub-task update failed", err.message));
}

export function removeSubtask(id: string, subId: string) {
  const p = findProject(id); if (!p) return;
  localPatch(id, { subtasks: p.subtasks.filter((s) => s.id !== subId) });
  del(`/api/subtasks/${subId}`)
    .catch((err: ApiError) => writeFailed("Sub-task didn't delete", err.message));
}

export function reassignSubtask(id: string, subId: string, assigneeId: string | undefined) {
  const p = findProject(id); if (!p) return;
  localPatch(id, { subtasks: p.subtasks.map((s) => (s.id === subId ? { ...s, assigneeId } : s)) });
  post(`/api/subtasks/${subId}/reassign`, { assigneeId })
    .catch((err: ApiError) => writeFailed("Sub-task didn't reassign", err.message));
}

export async function createProject(
  input: Omit<Project, "id" | "code" | "createdAt" | "stageEnteredAt" | "finalGoLive" | "history" | "comments" | "subtasks" | "attachments" | "stageTargets"> & { subtasks?: SubTask[] }
): Promise<Project> {
  const proj = await post<Project>("/api/projects", {
    title: input.title, brd: input.brd, partner: input.partner, brand: input.brand, lob: input.lob,
    priority: input.priority, bifurcation: input.bifurcation, stage: input.stage, status: input.status,
    ownerId: input.ownerId, businessOwnerId: input.businessOwnerId,
    blocked: input.blocked, blockReason: input.blockReason ?? null,
    targetGoLive: input.targetGoLive, sacrosanctGoLive: input.sacrosanctGoLive,
    priorityMonth: input.priorityMonth, timelineEta: input.timelineEta,
    devEffortDays: input.devEffortDays, reasonForDelay: input.reasonForDelay,
    productSpocId: input.productSpocId, techLeadId: input.techLeadId,
    subtasks: input.subtasks,
  });
  await fetchAll();
  return findProject(proj.id) ?? proj;
}

export function resetDemo() {
  console.warn("resetDemo is a no-op in cloud mode — this would wipe shared production data.");
}
