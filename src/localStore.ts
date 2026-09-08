/* ─── Local demo store — persists to localStorage. Used when no
   VITE_SUPABASE_* env vars are set. See cloudStore.ts for the live backend. ─── */
import { useEffect, useState } from "react";
import type { Project, StageId, StatusId, Comment, SubTask } from "./types";
import { SEED_PROJECTS } from "./seed";
import { STAGE_BY_ID, STATUSES } from "./workflow";
import { uid, now } from "./lib";

const KEY = "gyftr_tech_portal_v1";

function load(): Project[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Project[];
  } catch { /* ignore */ }
  return structuredClone(SEED_PROJECTS);
}

let state: Project[] = load();
const listeners = new Set<() => void>();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

/* Cross-tab live sync: when another tab (another logged-in user) writes,
   pull the new state and re-render — so a change by one role shows to the others. */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY && e.newValue) {
      try { state = JSON.parse(e.newValue) as Project[]; listeners.forEach((l) => l()); } catch { /* ignore */ }
    }
  });
}

function update(id: string, fn: (p: Project) => Project) {
  state = state.map((p) => (p.id === id ? fn(p) : p));
  persist();
}

/* ── Actions ── */

export function moveToStage(id: string, toStage: StageId, byId: string, note?: string) {
  update(id, (p) => {
    if (p.stage === toStage) return p;
    const meta = STAGE_BY_ID[toStage];
    const toStatus = meta.defaultStatus;
    return {
      ...p,
      stage: toStage,
      status: toStatus,
      ownerId: pickOwner(p, toStage, byId),
      blocked: STATUSES[toStatus].kind === "blocked",
      blockReason: STATUSES[toStatus].kind === "blocked" ? p.blockReason : undefined,
      stageEnteredAt: now(),
      history: [
        ...p.history,
        { id: uid("h"), at: now(), byId, fromStage: p.stage, toStage, fromStatus: p.status, toStatus, note },
      ],
    };
  });
}

/** The one state-machine move: hand the ball on per a TransitionSpec. */
export function transition(
  id: string, byId: string,
  spec: { to: StageId; toStatus: StatusId; label: string },
  newOwnerId: string
) {
  update(id, (p) => ({
    ...p,
    stage: spec.to,
    status: spec.toStatus,
    ownerId: newOwnerId,
    blocked: STATUSES[spec.toStatus].kind === "blocked",
    blockReason: STATUSES[spec.toStatus].kind === "blocked" ? p.blockReason : undefined,
    stageEnteredAt: now(),
    finalGoLive: spec.to === "live" && !p.finalGoLive ? new Date().toISOString().slice(0, 10) : p.finalGoLive,
    history: [
      ...p.history,
      { id: uid("h"), at: now(), byId, fromStage: p.stage, toStage: spec.to, fromStatus: p.status, toStatus: spec.toStatus, note: spec.label },
    ],
  }));
}

/** Sheet-parity planning fields — editable from the project page's Details rail. */
export type DetailsPatch = Partial<Pick<Project,
  "priorityMonth" | "timelineEta" | "devEffortDays" | "reasonForDelay" |
  "productSpocId" | "techLeadId" | "targetGoLive" | "sacrosanctGoLive" | "brand">>;

export function updateDetails(id: string, patch: DetailsPatch) {
  update(id, (p) => ({ ...p, ...patch }));
}

/** Per-stage expected date. */
export function setStageTarget(id: string, stage: StageId, _byId: string, expectedDate: string | null) {
  void _byId;
  update(id, (p) => ({ ...p, stageTargets: { ...p.stageTargets, [stage]: expectedDate ?? undefined } }));
}

export function setStatus(id: string, toStatus: StatusId, byId: string) {
  update(id, (p) => {
    if (p.status === toStatus) return p;
    const meta = STATUSES[toStatus];
    const stageChanged = meta.stage !== p.stage && meta.kind !== "blocked";
    return {
      ...p,
      status: toStatus,
      stage: stageChanged ? meta.stage : p.stage,
      blocked: meta.kind === "blocked",
      stageEnteredAt: stageChanged ? now() : p.stageEnteredAt,
      history: [
        ...p.history,
        { id: uid("h"), at: now(), byId, fromStage: p.stage, toStage: stageChanged ? meta.stage : p.stage, fromStatus: p.status, toStatus },
      ],
    };
  });
}

export function reassign(id: string, ownerId: string) {
  update(id, (p) => ({ ...p, ownerId }));
}

/** Tech SPOC / dev picks up a queued project → moves into Development. */
export function pickUp(id: string, byId: string) {
  update(id, (p) => {
    if (p.stage !== "to_be_picked") return p;
    return {
      ...p, stage: "development", status: "dev", ownerId: byId, blocked: false, stageEnteredAt: now(),
      history: [...p.history, { id: uid("h"), at: now(), byId, fromStage: p.stage, toStage: "development", fromStatus: p.status, toStatus: "dev", note: "Picked up" }],
    };
  });
}

/** Bounce the ball back to a team that owes an answer (the clarification loop). */
export function requestClarification(id: string, byId: string, toStage: StageId, toStatus: StatusId, note: string, newOwnerId: string) {
  update(id, (p) => ({
    ...p, stage: toStage, status: toStatus, ownerId: newOwnerId, blocked: true, blockReason: note, stageEnteredAt: now(),
    history: [...p.history, { id: uid("h"), at: now(), byId, fromStage: p.stage, toStage, fromStatus: p.status, toStatus, note: `Clarification requested: ${note}` }],
  }));
}

/** Reopen a UAT/Live item — send it back to Dev for fixes. */
export function reopen(id: string, byId: string, note: string, devOwnerId: string) {
  update(id, (p) => ({
    ...p, stage: "development", status: "need_bug_fixing", ownerId: devOwnerId, blocked: false, stageEnteredAt: now(),
    history: [...p.history, { id: uid("h"), at: now(), byId, fromStage: p.stage, toStage: "development", fromStatus: p.status, toStatus: "need_bug_fixing", note: `Reopened: ${note}` }],
  }));
}

export function setBlock(id: string, blocked: boolean, reason?: string) {
  update(id, (p) => ({ ...p, blocked, blockReason: blocked ? reason : undefined }));
}

export function setHold(id: string, onHold: boolean, reason: string | undefined, byId: string, byTeam: import("./types").TeamId) {
  update(id, (p) => ({
    ...p, onHold, holdReason: onHold ? reason : undefined,
    heldById: onHold ? byId : undefined, heldByTeam: onHold ? byTeam : undefined,
    heldAt: onHold ? now() : undefined,
  }));
}

export function addComment(id: string, byId: string, text: string, pinned = false) {
  const c: Comment = { id: uid("c"), at: now(), byId, text, pinned };
  update(id, (p) => ({ ...p, comments: [...p.comments, c] }));
}

export function resolveNote(id: string, commentId: string) {
  update(id, (p) => ({ ...p, comments: p.comments.map((c) => (c.id === commentId ? { ...c, resolved: true } : c)) }));
}

export function addAttachment(id: string, byId: string, name: string, kind: import("./types").DocKind, url?: string) {
  const a = { id: uid("a"), name, kind, url, byId, at: now() };
  update(id, (p) => ({ ...p, attachments: [...p.attachments, a] }));
}

export function toggleSubtask(id: string, subId: string) {
  update(id, (p) => ({
    ...p,
    subtasks: p.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)),
  }));
}

export function addSubtask(id: string, sub: Omit<SubTask, "id">) {
  update(id, (p) => ({ ...p, subtasks: [...p.subtasks, { ...sub, id: uid("s"), createdAt: now() }] }));
}

export function removeSubtask(id: string, subId: string) {
  update(id, (p) => ({ ...p, subtasks: p.subtasks.filter((s) => s.id !== subId) }));
}

export function reassignSubtask(id: string, subId: string, assigneeId: string | undefined) {
  update(id, (p) => ({ ...p, subtasks: p.subtasks.map((s) => (s.id === subId ? { ...s, assigneeId } : s)) }));
}

export type SubtaskPatch = Partial<Pick<import("./types").SubTask, "promisedDate" | "effortDays" | "expectedDate">>;

export function updateSubtask(id: string, subId: string, patch: SubtaskPatch) {
  update(id, (p) => ({ ...p, subtasks: p.subtasks.map((s) => (s.id === subId ? { ...s, ...patch } : s)) }));
}

export function createProject(input: Omit<Project, "id" | "code" | "createdAt" | "stageEnteredAt" | "finalGoLive" | "history" | "comments" | "subtasks" | "attachments" | "stageTargets" | "onHold" | "holdReason" | "heldById" | "heldByTeam" | "heldAt"> & { subtasks?: SubTask[] }) {
  const n = state.length + 1;
  const code = `TP-${String(n).padStart(3, "0")}`;
  const proj: Project = {
    ...input,
    id: code.toLowerCase(),
    code,
    createdAt: now(),
    stageEnteredAt: now(),
    finalGoLive: null,
    onHold: false,
    stageTargets: {},
    subtasks: input.subtasks ?? [],
    comments: [],
    attachments: [],
    history: [{ id: uid("h"), at: now(), byId: input.businessOwnerId, fromStage: null, toStage: input.stage, fromStatus: null, toStatus: input.status, note: "Project created" }],
  };
  state = [proj, ...state];
  persist();
  return proj;
}

export function resetDemo() {
  state = structuredClone(SEED_PROJECTS);
  persist();
}

/** When the ball moves to a new lane, hand it to that lane's team lead by default. */
function pickOwner(p: Project, stage: StageId, fallback: string): string {
  return fallback || p.ownerId;
}

/* ── React binding ── */
export function useProjects(): Project[] {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return state;
}
