/* ─── Reusable UI primitives ─── */
import type { CSSProperties } from "react";
import { Clock, AlertOctagon, Star } from "lucide-react";
import { STATUSES, PRIORITY_META, aging, STAGE_BY_ID } from "./workflow";
import type { Project, StatusId, Priority } from "./types";
import { initials, colorFor, daysBetween, overdueInfo } from "./lib";
import { openLeadershipNote } from "./roles";
import { PEOPLE_BY_ID } from "./people";

export function Avatar({ id, size = 26 }: { id: string; size?: number }) {
  const p = PEOPLE_BY_ID[id];
  const name = p?.name ?? "—";
  return (
    <div className="avatar" title={name} style={{ width: size, height: size, fontSize: size * 0.4, background: colorFor(name) }}>
      {initials(name)}
    </div>
  );
}

export function StatusPill({ status }: { status: StatusId }) {
  const s = STATUSES[status];
  return (
    <span className="pill" style={{ background: s.bg, color: s.fg }}>
      <span className="dot" style={{ background: s.fg }} />
      {s.label}
    </span>
  );
}

export function PriorityChip({ p }: { p: Priority }) {
  const m = PRIORITY_META[p];
  return <span className="pill mono" style={{ background: m.bg, color: m.fg, padding: "3px 9px" }}>{p}</span>;
}

export function AgingChip({ project }: { project: Project }) {
  const days = daysBetween(project.stageEnteredAt);
  const sla = STAGE_BY_ID[project.stage].slaDays;
  const level = project.stage === "live" ? "ok" : aging(days, sla);
  const label = project.stage === "live" ? "live" : `${days}d`;
  return (
    <span className={`aging ${level}`} title={`${days} days in ${STAGE_BY_ID[project.stage].label} · SLA ${sla}d`}>
      <Clock size={11} /> {label}
    </span>
  );
}

export function OverdueTag({ project }: { project: Project }) {
  const { overdue, days } = overdueInfo(project.sacrosanctGoLive, project.targetGoLive, project.stage === "live");
  if (!overdue) return null;
  return <span className="overdue-tag" title="Past committed go-live date"><AlertOctagon size={12} /> {days}d late</span>;
}

export function CeoNote({ project }: { project: Project }) {
  if (!openLeadershipNote(project)) return null;
  return <span className="ceo-badge" title="Priority note from leadership"><Star size={10} fill="currentColor" /> CEO note</span>;
}

export function Pill({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return <span className="pill" style={style}>{children}</span>;
}
