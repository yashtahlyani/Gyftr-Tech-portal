import { useState } from "react";
import { ArrowRight, CheckCircle2, ListTodo } from "lucide-react";
import type { Person, Project } from "../types";
import { STAGE_BY_ID, forwardOf, PRIORITY_META } from "../workflow";
import { isMine, canPerformTransition, ownerForTransition, openLeadershipNote } from "../roles";
import { transition, updateSubtask, toggleSubtask } from "../store";
import { daysBetween, fmtDate } from "../lib";
import { Avatar, StatusPill, PriorityChip, AgingChip, OverdueTag, CeoNote } from "../ui";
import { PEOPLE_BY_ID } from "../people";
import { toast } from "../toast";

export function MyQueue({ projects, me, onOpen }: { projects: Project[]; me: Person; onOpen: (id: string) => void }) {
  const mine = projects
    .filter((p) => isMine(me, p))
    .sort((a, b) =>
      (Number(openLeadershipNote(b)) - Number(openLeadershipNote(a))) ||
      (PRIORITY_META[b.priority].rank - PRIORITY_META[a.priority].rank) ||
      (daysBetween(b.stageEnteredAt) - daysBetween(a.stageEnteredAt))
    );

  const mySubtasks = projects.flatMap((p) =>
    p.subtasks
      .filter((s) => s.assigneeId === me.id)
      .map((s) => ({ sub: s, proj: p }))
  ).sort((a, b) => Number(a.sub.done) - Number(b.sub.done) || (a.sub.createdAt ?? 0) - (b.sub.createdAt ?? 0));

  const blocked = mine.filter((p) => p.blocked).length;
  const pendingSubs = mySubtasks.filter((x) => !x.sub.done).length;

  if (mine.length === 0 && mySubtasks.length === 0) {
    return (
      <div className="empty fade">
        <CheckCircle2 size={40} />
        <h3 style={{ marginBottom: 4 }}>You're all clear</h3>
        <div style={{ fontSize: 13 }}>Nothing is waiting in your court right now.</div>
      </div>
    );
  }

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 32 }}>

      {/* ── Section 1: Projects in my court ── */}
      <div>
        <div style={{ display: "flex", gap: 18, marginBottom: 12, alignItems: "baseline" }}>
          <div style={{ fontFamily: "var(--font-d)", fontSize: 15, fontWeight: 700 }}>Projects in my court</div>
          <div><b style={{ fontFamily: "var(--font-d)", fontSize: 14 }}>{mine.length}</b> <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>item{mine.length !== 1 ? "s" : ""}</span></div>
          {blocked > 0 && <div style={{ color: "var(--rose-fg)", fontSize: 13, fontWeight: 600 }}>{blocked} blocked</div>}
        </div>

        {mine.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink-mute)", padding: "12px 0" }}>No projects in your court right now.</div>
        ) : (
          <div className="grid stagger" style={{ gridTemplateColumns: "1fr" }}>
            {mine.map((p) => {
              const fwd = forwardOf(p.stage);
              const canFwd = !!fwd && canPerformTransition(me, p, fwd);
              return (
                <div key={p.id} className="panel" style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 18px", cursor: "pointer" }} onClick={() => onOpen(p.id)}>
                  <span className="col-accent" style={{ background: STAGE_BY_ID[p.stage].color, height: 34, width: 4 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span className="card-code">{p.code}</span>
                      <PriorityChip p={p.priority} />
                      <span style={{ fontWeight: 650, fontSize: 14 }}>{p.title}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span className="chip">{p.partner}</span>
                      <StatusPill status={p.status} />
                      <AgingChip project={p} />
                      <OverdueTag project={p} />
                      <CeoNote project={p} />
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }} onClick={(e) => e.stopPropagation()}>
                    {canFwd && fwd && (
                      // "Send to Tech Manager" needs an explicit "who exactly is
                      // this for" pick (SVP/CTO/dispatcher) — this quick-forward
                      // shortcut has no way to ask that, and ownerForTransition's
                      // leadOf() fallback would silently dump everything on
                      // whichever one person it resolves to. Route to the
                      // Drawer's picker instead of guessing.
                      fwd.to === "to_be_picked" ? (
                        <button className="btn subtle sm" onClick={() => { toast("Open the project to pick who on the Tech side this is for."); onOpen(p.id); }}>
                          {fwd.label} <ArrowRight size={13} />
                        </button>
                      ) : (
                        <button className="btn subtle sm" onClick={() => transition(p.id, me.id, fwd, ownerForTransition(fwd, me))}>
                          {fwd.label} <ArrowRight size={13} />
                        </button>
                      )
                    )}
                    <button className="btn sm" onClick={() => onOpen(p.id)}>Open</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Section 2: Subtasks assigned to me ── */}
      <div>
        <div style={{ display: "flex", gap: 18, marginBottom: 12, alignItems: "baseline" }}>
          <div style={{ fontFamily: "var(--font-d)", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
            <ListTodo size={15} /> My subtasks
          </div>
          <div><b style={{ fontFamily: "var(--font-d)", fontSize: 14 }}>{pendingSubs}</b> <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>pending</span></div>
        </div>

        {mySubtasks.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink-mute)", padding: "12px 0" }}>No subtasks assigned to you yet.</div>
        ) : (
          <div className="grid stagger" style={{ gridTemplateColumns: "1fr" }}>
            {mySubtasks.map(({ sub, proj }) => (
              <SubtaskQueueRow key={sub.id} sub={sub} proj={proj} me={me} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SubtaskQueueRow({ sub, proj, me, onOpen }: {
  sub: import("../types").SubTask;
  proj: Project;
  me: Person;
  onOpen: (id: string) => void;
}) {
  const [editingPromised, setEditingPromised] = useState(false);
  const [editingEffort, setEditingEffort] = useState(false);
  const [promisedVal, setPromisedVal] = useState(sub.promisedDate ?? "");
  const [effortVal, setEffortVal] = useState(sub.effortDays != null ? String(sub.effortDays) : "");

  const savePromised = () => {
    setEditingPromised(false);
    const v = promisedVal || undefined;
    if (v !== sub.promisedDate) updateSubtask(proj.id, sub.id, { promisedDate: v });
  };
  const saveEffort = () => {
    setEditingEffort(false);
    const v = effortVal ? Number(effortVal) : undefined;
    if (v !== sub.effortDays) updateSubtask(proj.id, sub.id, { effortDays: v });
  };

  return (
    <div className="panel" style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", opacity: sub.done ? 0.55 : 1 }}>
      {/* Done toggle */}
      <button onClick={() => toggleSubtask(proj.id, sub.id)} title={sub.done ? "Mark pending" : "Mark done"} style={{ flex: "none" }}>
        {sub.done
          ? <CheckCircle2 size={18} color="var(--pop)" />
          : <span style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid var(--ink-mute)", display: "inline-block" }} />}
      </button>

      {/* Title + project */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 650, fontSize: 13.5, textDecoration: sub.done ? "line-through" : "none", marginBottom: 3 }}>{sub.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--ink-mute)" }}>
          <span className="card-code" style={{ fontSize: 11 }}>{proj.code}</span>
          <span>{proj.title}</span>
        </div>
      </div>

      {/* Dates */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flex: "none" }}>
        {/* Expected date — set by assigner, read-only here */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "var(--ink-mute)", fontWeight: 700, marginBottom: 2 }}>EXPECTED</div>
          <div className="mono" style={{ fontSize: 12, color: "var(--ink-soft)" }}>{fmtDate(sub.expectedDate ?? null) || "—"}</div>
        </div>

        {/* Promised date — assignee sets */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "var(--ink-mute)", fontWeight: 700, marginBottom: 2 }}>PROMISED</div>
          {editingPromised ? (
            <input
              type="date" className="input mono" autoFocus
              style={{ width: 130, padding: "2px 6px", fontSize: 12 }}
              value={promisedVal}
              onChange={(e) => setPromisedVal(e.target.value)}
              onBlur={savePromised}
              onKeyDown={(e) => e.key === "Enter" && savePromised()}
            />
          ) : (
            <button onClick={() => setEditingPromised(true)} style={{ display: "block" }} title="Set your promised date">
              <span className="mono" style={{ fontSize: 12, color: sub.promisedDate ? "var(--ink-soft)" : "var(--ink-mute)" }}>
                {fmtDate(sub.promisedDate ?? null) || "Set date"}
              </span>
            </button>
          )}
        </div>

        {/* Effort — assignee sets */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "var(--ink-mute)", fontWeight: 700, marginBottom: 2 }}>EFFORT</div>
          {editingEffort ? (
            <input
              type="number" min="0" className="input mono" autoFocus
              style={{ width: 64, padding: "2px 6px", fontSize: 12, textAlign: "right" }}
              value={effortVal}
              onChange={(e) => setEffortVal(e.target.value)}
              onBlur={saveEffort}
              onKeyDown={(e) => e.key === "Enter" && saveEffort()}
            />
          ) : (
            <button onClick={() => setEditingEffort(true)} title="Set effort in man-days">
              <span className="mono" style={{ fontSize: 12, color: sub.effortDays != null ? "var(--ink-soft)" : "var(--ink-mute)" }}>
                {sub.effortDays != null ? `${sub.effortDays}d` : "Set"}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Open project */}
      <button className="btn sm" style={{ flex: "none" }} onClick={() => onOpen(proj.id)}>Open</button>
    </div>
  );
}
