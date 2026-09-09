import { useMemo, useEffect, useState, useRef } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList,
  PieChart, Pie, CartesianGrid,
} from "recharts";
import { AlertTriangle, Flame, Rocket, Ban, AlertOctagon, CheckCircle2, Clock, ListTodo } from "lucide-react";
import type { Person, Project } from "../types";
import { STAGES, STAGE_BY_ID, TEAMS, aging } from "../workflow";
import { daysBetween, fmtDate, overdueInfo } from "../lib";
import { PEOPLE_BY_ID } from "../people";
import { isMine, isOverseer } from "../roles";
import { Avatar, StatusPill, AgingChip, OverdueTag, PriorityChip } from "../ui";

/* Gyftr-tuned categorical (green-led, muted, professional) */
const CAT = ["#62A92A", "#35618E", "#C79A3E", "#1C7A64", "#8A6FB0", "#B23A32"];

function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    const start = performance.now(); const from = ref.current; let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setV(Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick); else ref.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Kpi({ lbl, num, Icon, color }: { lbl: string; num: number; Icon: typeof Flame; color: string }) {
  const val = useCountUp(num);
  return (
    <div className="panel kpi">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
        <span className="lbl">{lbl}</span>
        <div className="kpi-icon" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}><Icon size={17} /></div>
      </div>
      <span className="num" style={{ color }}>{val}</span>
    </div>
  );
}

const tip = { borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 12, boxShadow: "var(--sh-md)", color: "var(--ink)" };

/** Personal dashboard for non-overseers: my court, my subtasks, overdue, blocked. */
function PersonalDashboard({ projects, me, onOpen }: { projects: Project[]; me: Person; onOpen: (id: string) => void }) {
  const stats = useMemo(() => {
    const inCourt = projects.filter((p) => isMine(me, p));
    const mySubtasks = projects.flatMap((p) =>
      p.subtasks.filter((s) => s.assigneeId === me.id).map((s) => ({ sub: s, proj: p }))
    );
    const pendingSubs = mySubtasks.filter((x) => !x.sub.done);
    const blockedProjects = inCourt.filter((p) => p.blocked);
    const overdueProjects = inCourt.filter((p) => overdueInfo(p.sacrosanctGoLive, p.targetGoLive, false).overdue);
    return { inCourt, mySubtasks, pendingSubs, blockedProjects, overdueProjects };
  }, [projects, me]);

  const courtCount = useCountUp(stats.inCourt.length);
  const subCount = useCountUp(stats.pendingSubs.length);
  const overdueCount = useCountUp(stats.overdueProjects.length);
  const blockedCount = useCountUp(stats.blockedProjects.length);

  return (
    <div className="grid stagger" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
      {/* KPIs */}
      <div className="panel kpi">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
          <span className="lbl">In My Court</span>
          <div className="kpi-icon" style={{ background: "color-mix(in srgb, var(--pop-deep) 14%, transparent)", color: "var(--pop-deep)" }}><Rocket size={17} /></div>
        </div>
        <span className="num" style={{ color: "var(--pop-deep)" }}>{courtCount}</span>
      </div>
      <div className="panel kpi">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
          <span className="lbl">Pending Subtasks</span>
          <div className="kpi-icon" style={{ background: "color-mix(in srgb, var(--blue-fg) 14%, transparent)", color: "var(--blue-fg)" }}><ListTodo size={17} /></div>
        </div>
        <span className="num" style={{ color: "var(--blue-fg)" }}>{subCount}</span>
      </div>
      <div className="panel kpi">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
          <span className="lbl">Overdue</span>
          <div className="kpi-icon" style={{ background: "color-mix(in srgb, var(--amber-fg) 14%, transparent)", color: "var(--amber-fg)" }}><Clock size={17} /></div>
        </div>
        <span className="num" style={{ color: "var(--amber-fg)" }}>{overdueCount}</span>
      </div>
      <div className="panel kpi">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
          <span className="lbl">Blocked</span>
          <div className="kpi-icon" style={{ background: "color-mix(in srgb, var(--rose-fg) 14%, transparent)", color: "var(--rose-fg)" }}><Ban size={17} /></div>
        </div>
        <span className="num" style={{ color: "var(--rose-fg)" }}>{blockedCount}</span>
      </div>

      {/* Projects in my court */}
      <div className="panel" style={{ gridColumn: "span 4" }}>
        <h3>Projects in my court</h3>
        <div className="hint">These need your action — your team currently holds the ball.</div>
        {stats.inCourt.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 0", color: "var(--ink-mute)", fontSize: 13 }}>
            <CheckCircle2 size={20} color="var(--pop)" /> You're clear — nothing in your court right now.
          </div>
        ) : (
          <div className="tablewrap" style={{ boxShadow: "none" }}>
            <table className="table">
              <thead><tr><th>Project</th><th>Partner</th><th>Stage</th><th>Status</th><th>Promised Date</th><th>Age</th></tr></thead>
              <tbody>
                {stats.inCourt.map((p) => (
                  <tr key={p.id} onClick={() => onOpen(p.id)}>
                    <td><span className="mono" style={{ color: "var(--ink-mute)", fontWeight: 600, marginRight: 8, fontSize: 11 }}>{p.code}</span><PriorityChip p={p.priority} />{" "}{p.title}</td>
                    <td><span className="chip">{p.partner}</span></td>
                    <td>{STAGE_BY_ID[p.stage].label}</td>
                    <td><StatusPill status={p.status} /></td>
                    <td><span className="mono" style={{ fontSize: 12 }}>{fmtDate(p.sacrosanctGoLive)}</span><OverdueTag project={p} /></td>
                    <td><AgingChip project={p} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* My subtasks */}
      <div className="panel" style={{ gridColumn: "span 4" }}>
        <h3>My subtasks</h3>
        <div className="hint">Subtasks assigned to you across all projects.</div>
        {stats.mySubtasks.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink-mute)", padding: "12px 0" }}>No subtasks assigned to you yet.</div>
        ) : (
          <div className="tablewrap" style={{ boxShadow: "none" }}>
            <table className="table">
              <thead><tr><th>Subtask</th><th>Project</th><th>Expected</th><th>Promised</th><th>Effort</th><th>Status</th></tr></thead>
              <tbody>
                {stats.mySubtasks.map(({ sub, proj }) => (
                  <tr key={sub.id} onClick={() => onOpen(proj.id)} style={{ opacity: sub.done ? 0.5 : 1 }}>
                    <td style={{ textDecoration: sub.done ? "line-through" : "none" }}>{sub.title}</td>
                    <td><span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", marginRight: 6 }}>{proj.code}</span>{proj.title}</td>
                    <td><span className="mono" style={{ fontSize: 12 }}>{fmtDate(sub.expectedDate ?? null)}</span></td>
                    <td><span className="mono" style={{ fontSize: 12 }}>{fmtDate(sub.promisedDate ?? null)}</span></td>
                    <td>{sub.effortDays != null ? <span className="chip">{sub.effortDays}d</span> : "—"}</td>
                    <td>{sub.done ? <span className="chip" style={{ background: "var(--pop-soft)", color: "var(--pop-deep)" }}>Done</span> : <span className="chip">Pending</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function Dashboard({ projects, me, onOpen }: { projects: Project[]; me: Person; onOpen: (id: string) => void }) {
  if (!isOverseer(me)) return <PersonalDashboard projects={projects} me={me} onOpen={onOpen} />;
  return <OrgDashboard projects={projects} onOpen={onOpen} />;
}

function OrgDashboard({ projects, onOpen }: { projects: Project[]; onOpen: (id: string) => void }) {
  const stats = useMemo(() => {
    const active = projects.filter((p) => p.stage !== "live");
    const live = projects.filter((p) => p.stage === "live");
    const blocked = active.filter((p) => p.blocked);
    const breaching = active.filter((p) => aging(daysBetween(p.stageEnteredAt), STAGE_BY_ID[p.stage].slaDays) === "breach");
    const overdue = active.filter((p) => overdueInfo(p.sacrosanctGoLive, p.targetGoLive, false).overdue);

    const byStage = STAGES.filter((s) => s.id !== "live").map((s) => ({ name: s.label, value: projects.filter((p) => p.stage === s.id).length }));

    const ballMap = new Map<string, number>();
    for (const p of active) { const t = STAGE_BY_ID[p.stage].owner; ballMap.set(t, (ballMap.get(t) ?? 0) + 1); }
    const ball = [...ballMap.entries()].map(([t, value]) => ({ name: TEAMS[t as keyof typeof TEAMS].label, value })).sort((a, b) => b.value - a.value);

    const aged = [...active].sort((a, b) => daysBetween(b.stageEnteredAt) - daysBetween(a.stageEnteredAt)).slice(0, 6);
    return { active, live, blocked, breaching, overdue, byStage, ball, aged };
  }, [projects]);

  const totalBall = stats.ball.reduce((s, b) => s + b.value, 0);

  return (
    <div className="grid stagger" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
      <Kpi lbl="Active Projects" num={stats.active.length} Icon={Rocket} color="var(--pop-deep)" />
      <Kpi lbl="Breaching SLA"   num={stats.breaching.length} Icon={Flame} color="var(--rose-fg)" />
      <Kpi lbl="Overdue"         num={stats.overdue.length} Icon={AlertOctagon} color="var(--amber-fg)" />
      <Kpi lbl="Blocked"         num={stats.blocked.length} Icon={Ban} color="var(--slate-fg)" />

      <div className="panel" style={{ gridColumn: "span 2" }}>
        <h3>Pipeline distribution</h3>
        <div className="hint">How many projects sit in each stage right now.</div>
        <ResponsiveContainer width="100%" height={228}>
          <BarChart data={stats.byStage} margin={{ top: 18, right: 8, left: -22, bottom: 4 }}>
            <defs>
              <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7FBE45" /><stop offset="100%" stopColor="#4C8A1E" />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 4" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--ink-mute)" }} interval={0} angle={-20} textAnchor="end" height={56} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--ink-mute)" }} axisLine={false} tickLine={false} width={40} />
            <Tooltip cursor={{ fill: "var(--surface-2)", radius: 6 }} contentStyle={tip} />
            <Bar dataKey="value" fill="url(#barFill)" radius={[6, 6, 0, 0]} maxBarSize={44}>
              <LabelList dataKey="value" position="top" style={{ fill: "var(--ink-soft)", fontSize: 11, fontWeight: 700 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="panel" style={{ gridColumn: "span 2" }}>
        <h3>Whose court is the ball in?</h3>
        <div className="hint">Active projects grouped by the team that currently owns them.</div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ position: "relative", width: 200, height: 200, flex: "none" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats.ball} dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={3} strokeWidth={2} stroke="var(--surface)">
                  {stats.ball.map((_, i) => <Cell key={i} fill={CAT[i % CAT.length]} />)}
                </Pie>
                <Tooltip contentStyle={tip} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-d)", fontSize: 28, fontWeight: 800 }}>{totalBall}</div>
                <div style={{ fontSize: 10, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700 }}>in play</div>
              </div>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
            {stats.ball.map((b, i) => (
              <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: CAT[i % CAT.length], flex: "none" }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{b.name}</span>
                <b className="mono" style={{ fontSize: 13 }}>{b.value}</b>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel" style={{ gridColumn: "span 4" }}>
        <h3><AlertTriangle size={14} style={{ verticalAlign: -2, color: "var(--rose-fg)" }} /> Ageing watchlist — chase these first</h3>
        <div className="hint">The projects that have sat longest in their current stage. This is the escalation list.</div>
        <div className="tablewrap" style={{ boxShadow: "none" }}>
          <table className="table">
            <thead>
              <tr><th>Project</th><th>Partner</th><th>Stage</th><th>Status</th><th>Owner</th><th>In stage</th><th>Sacrosanct</th></tr>
            </thead>
            <tbody>
              {stats.aged.map((p) => (
                <tr key={p.id} onClick={() => onOpen(p.id)}>
                  <td><span className="mono" style={{ color: "var(--ink-mute)", fontWeight: 600, marginRight: 8, fontSize: 11 }}>{p.code}</span>{p.title}</td>
                  <td><span className="chip">{p.partner}</span></td>
                  <td>{STAGE_BY_ID[p.stage].label}</td>
                  <td><StatusPill status={p.status} /></td>
                  <td><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar id={p.ownerId} size={24} /><span style={{ fontSize: 12.5 }}>{PEOPLE_BY_ID[p.ownerId]?.name}</span></div></td>
                  <td><AgingChip project={p} /></td>
                  <td style={{ fontSize: 12 }}><div style={{ display: "flex", alignItems: "center", gap: 7 }}><span className="mono">{fmtDate(p.sacrosanctGoLive)}</span><OverdueTag project={p} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
