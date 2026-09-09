import { useMemo } from "react";
import { ShieldCheck, Ban, AlertOctagon, Flame, Star, Clock } from "lucide-react";
import type { Project } from "../types";
import { STAGE_BY_ID, TEAMS, aging } from "../workflow";
import { daysBetween, overdueInfo, fmtDate } from "../lib";
import { ownerTeam, openLeadershipNote } from "../roles";
import { PEOPLE_BY_ID } from "../people";
import { Avatar, StatusPill, AgingChip, OverdueTag } from "../ui";

const TODAY = new Date().toISOString().slice(0, 10);

export function Escalations({ projects, onOpen }: { projects: Project[]; onOpen: (id: string) => void }) {
  const rows = useMemo(() => {
    return projects
      .filter((p) => p.stage !== "live")
      .map((p) => {
        const breach = aging(daysBetween(p.stageEnteredAt), STAGE_BY_ID[p.stage].slaDays) === "breach";
        const od = overdueInfo(p.sacrosanctGoLive, p.targetGoLive, false).overdue;
        const ceo = openLeadershipNote(p);
        const stageTarget = p.stageTargets[p.stage];
        const stageOverdue = !!stageTarget && stageTarget < TODAY;
        const score = (ceo ? 8 : 0) + (p.blocked ? 4 : 0) + (od ? 2 : 0) + (stageOverdue ? 2 : 0) + (breach ? 1 : 0);
        return { p, breach, od, ceo, stageOverdue, stageTarget, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || daysBetween(b.p.stageEnteredAt) - daysBetween(a.p.stageEnteredAt));
  }, [projects]);

  if (rows.length === 0) {
    return (
      <div className="empty fade">
        <ShieldCheck size={40} />
        <h3 style={{ marginBottom: 4 }}>Nothing to escalate</h3>
        <div style={{ fontSize: 13 }}>No blocked, overdue, or SLA-breaching projects right now.</div>
      </div>
    );
  }

  return (
    <div className="tablewrap fade">
      <table className="table">
        <thead>
          <tr><th>Project</th><th>Owner (who to chase)</th><th>Flags</th><th>In stage</th><th>Reason / block</th></tr>
        </thead>
        <tbody>
          {rows.map(({ p, breach, od, ceo, stageOverdue, stageTarget }) => (
            <tr key={p.id} onClick={() => onOpen(p.id)}>
              <td>
                <div style={{ fontWeight: 600 }}><span className="mono" style={{ color: "var(--ink-mute)", fontSize: 11, marginRight: 8 }}>{p.code}</span>{p.title}</div>
                <div style={{ marginTop: 5, display: "flex", gap: 6, alignItems: "center" }}><span className="chip">{p.partner}</span><StatusPill status={p.status} /></div>
              </td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar id={p.ownerId} size={26} />
                  <div><div style={{ fontSize: 12.5, fontWeight: 600 }}>{PEOPLE_BY_ID[p.ownerId]?.name}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{TEAMS[ownerTeam(p)].label}</div></div>
                </div>
              </td>
              <td>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {ceo && <span className="pill" style={{ background: "var(--gold-bg)", color: "var(--gold-fg)" }}><Star size={11} fill="currentColor" /> CEO</span>}
                  {p.blocked && <span className="pill" style={{ background: "var(--rose-bg)", color: "var(--rose-fg)" }}><Ban size={11} /> Blocked</span>}
                  {od && <span className="pill" style={{ background: "var(--amber-bg)", color: "var(--amber-fg)" }}><AlertOctagon size={11} /> Overdue</span>}
                  {stageOverdue && <span className="pill" style={{ background: "var(--rose-bg)", color: "var(--rose-fg)" }}><Clock size={11} /> {STAGE_BY_ID[p.stage].label} overdue</span>}
                  {breach && <span className="pill" style={{ background: "var(--rose-bg)", color: "var(--rose-fg)" }}><Flame size={11} /> SLA</span>}
                </div>
              </td>
              <td><AgingChip project={p} /></td>
              <td style={{ fontSize: 12.5, color: "var(--ink-soft)", maxWidth: 300 }}>
                {ceo ? p.comments.filter((c) => c.pinned && !c.resolved).slice(-1)[0]?.text
                  : p.blocked ? p.blockReason
                  : od ? <OverdueTag project={p} />
                  : stageOverdue ? `${STAGE_BY_ID[p.stage].label} was due ${fmtDate(stageTarget ?? null)}`
                  : "Over SLA in stage"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
