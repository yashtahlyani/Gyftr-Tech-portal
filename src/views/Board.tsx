import { useState } from "react";
import { AlertTriangle, Lock, PauseCircle } from "lucide-react";
import type { Person, Project, StageId } from "../types";
import { STAGES, STAGE_BY_ID, transitionBetween } from "../workflow";
import { transition } from "../store";
import { can, canPerformTransition, isReadOnly, ownerForTransition, openLeadershipNote } from "../roles";
import { Avatar, StatusPill, PriorityChip, AgingChip, OverdueTag, CeoNote } from "../ui";
import { toast } from "../toast";

function Card({ project, draggable, onOpen }: { project: Project; draggable: boolean; onOpen: () => void }) {
  const done = project.subtasks.filter((s) => s.done).length;
  const total = project.subtasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div
      className={`card ${project.blocked ? "blocked" : ""}`}
      draggable={draggable}
      onDragStart={(e) => draggable && e.dataTransfer.setData("text/plain", project.id)}
      onClick={onOpen}
    >
      <div className="card-top">
        <span className="card-code">{project.code}</span>
        {project.blocked && <AlertTriangle size={13} color="var(--rose-fg)" />}
        <div style={{ marginLeft: "auto" }}><PriorityChip p={project.priority} /></div>
      </div>
      <p className="card-title">{project.title}</p>
      <div className="card-meta">
        <span className="chip">{project.partner}</span>
        <StatusPill status={project.status} />
        <CeoNote project={project} />
      </div>
      <div className="card-meta" style={{ marginTop: 9 }}>
        <OverdueTag project={project} />
        {total > 0 && <>
          <div className="progressbar"><i style={{ width: `${pct}%` }} /></div>
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", fontWeight: 600 }}>{done}/{total}</span>
        </>}
      </div>
      <div className="card-foot">
        <Avatar id={project.ownerId} size={24} />
        <span style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 600 }}>{STAGE_BY_ID[project.stage].label}</span>
        <div style={{ marginLeft: "auto" }}><AgingChip project={project} /></div>
      </div>
    </div>
  );
}

export function Board({ projects, me, onOpen }: { projects: Project[]; me: Person; onOpen: (id: string) => void }) {
  const [over, setOver] = useState<StageId | null>(null);
  const readOnly = isReadOnly(me);

  // Held projects get pulled into their own leading category regardless of
  // stage — stage/status are untouched underneath, so un-holding (from the
  // Drawer) just returns a project to whatever stage column it already had.
  const held = projects
    .filter((p) => p.onHold)
    .sort((a, b) => (b.heldAt ?? 0) - (a.heldAt ?? 0));

  const byStage = (stage: StageId) =>
    projects.filter((p) => p.stage === stage && !p.onHold)
      .sort((a, b) => (Number(openLeadershipNote(b)) - Number(openLeadershipNote(a))) || (a.stageEnteredAt - b.stageEnteredAt));

  const handleDrop = (toStage: StageId, id: string) => {
    const proj = projects.find((p) => p.id === id);
    if (!proj) return;
    const spec = transitionBetween(proj.stage, toStage);          // only legal moves
    if (!spec || !canPerformTransition(me, proj, spec)) return;
    // "Send to Tech Manager" needs an explicit "who exactly is this for"
    // pick (SVP/CTO/dispatcher) — a drag has no way to ask that, and
    // ownerForTransition's leadOf() fallback would silently dump everything
    // on whichever one person it resolves to instead of letting the sender
    // choose. Route to the Drawer's picker instead of guessing.
    if (spec.to === "to_be_picked") {
      toast("Open the project to pick who on the Tech side this is for.");
      onOpen(id);
      return;
    }
    transition(id, me.id, spec, ownerForTransition(spec, me));
  };

  return (
    <div className="board">
      <div className="col">
        <div className="col-head">
          <span className="col-accent" style={{ background: "var(--amber-fg, #C79A3E)" }} />
          <b><PauseCircle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Projects on Hold</b>
          <span className="col-count">{held.length}</span>
        </div>
        <div className="col-body">
          {held.map((p) => <Card key={p.id} project={p} draggable={false} onOpen={() => onOpen(p.id)} />)}
          {held.length === 0 && <div className="col-empty">Nothing on hold</div>}
        </div>
      </div>
      {STAGES.map((stage) => {
        const list = byStage(stage.id);
        return (
          <div
            key={stage.id}
            className={`col ${over === stage.id ? "over" : ""}`}
            onDragOver={(e) => { if (!readOnly) { e.preventDefault(); setOver(stage.id); } }}
            onDragLeave={() => setOver((o) => (o === stage.id ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) handleDrop(stage.id, id); }}
          >
            <div className="col-head">
              <span className="col-accent" style={{ background: stage.color }} />
              <b>{stage.label}</b>
              <span className="col-count">{list.length}</span>
            </div>
            <div className="col-body">
              {list.map((p) => <Card key={p.id} project={p} draggable={!readOnly && can("advance", me, p)} onOpen={() => onOpen(p.id)} />)}
              {list.length === 0 && <div className="col-empty">Nothing here</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
