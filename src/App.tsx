import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, KanbanSquare, Table2, AlertOctagon, Inbox, Users,
  Plus, LogOut, RotateCcw, Cloud, HardDrive, Eye, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import type { Person, Project, ViewKey } from "./types";
import { useProjects, resetDemo } from "./store";
import { isCloud, daysBetween, overdueInfo } from "./lib";
import { PEOPLE, PEOPLE_BY_ID } from "./people";
import { useCloudAuth, signOutCloud } from "./auth";
import { TEAMS, STAGE_BY_ID, aging } from "./workflow";
import { can, isMine, isReadOnly, hasGlobalView, homeView, navFor, visibleTo, openLeadershipNote, orgSubtreeIds, subtreeVisibleTo } from "./roles";
import { Avatar } from "./ui";
import { GyftrLogo } from "./GyftrLogo";
import { Login } from "./views/Login";
import { CloudLogin, CloudLoginLoading, CloudNoAccess } from "./views/CloudLogin";
import { MyQueue } from "./views/MyQueue";
import { Board } from "./views/Board";
import { Dashboard } from "./views/Dashboard";
import { TableView } from "./views/TableView";
import { Escalations } from "./views/Escalations";
import { Drawer } from "./views/Drawer";
import { CreateModal } from "./views/CreateModal";
import { FilterBar, EMPTY_FILTERS, applyFilters, type Filters } from "./views/FilterBar";
import { useToasts } from "./toast";

function Toasts() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
    </div>
  );
}

const META: Record<ViewKey, { label: string; Icon: typeof Inbox; h: string; s: string }> = {
  queue:       { label: "My Queue",      Icon: Inbox,          h: "My Queue",      s: "Projects in your court + subtasks assigned to you" },
  team:        { label: "My Projects",   Icon: Users,          h: "My Projects",   s: "Projects you are contributing to" },
  overview:    { label: "Dashboard",     Icon: LayoutDashboard, h: "Dashboard",    s: "Health, tasks, and progress at a glance" },
  board:       { label: "Flow Board",    Icon: KanbanSquare,   h: "Flow Board",    s: "The whole pipeline — drag a project to move it along" },
  list:        { label: "All Projects",  Icon: Table2,         h: "All Projects",  s: "The PM sheet, live — every column, filterable, exportable" },
  escalations: { label: "Escalations",   Icon: AlertOctagon,   h: "Escalations",   s: "Blocked, overdue and SLA-breaching — who to chase" },
};

export default function App() {
  const [meId, setMeId] = useState<string | null>(() => localStorage.getItem("gtp_me"));
  const cloudAuth = useCloudAuth();
  const projects = useProjects();
  const me: Person | null = isCloud
    ? (cloudAuth.status === "signed_in" ? cloudAuth.me : null)
    : (meId ? PEOPLE_BY_ID[meId] : null);

  const [view, setView] = useState<ViewKey>(() => {
    const id = localStorage.getItem("gtp_me");
    return id && PEOPLE_BY_ID[id] ? homeView(PEOPLE_BY_ID[id], PEOPLE) : "queue";
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("gtp_sidebar_collapsed") === "1");
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem("gtp_sidebar_collapsed", c ? "0" : "1");
      return !c;
    });
  };

  // Switching who's logged in (profile switch, sign-out/sign-in) must never leave
  // the previous person's open project page, view, or filters showing by default.
  useEffect(() => {
    setOpenId(null);
    setCreating(false);
    setFilters(EMPTY_FILTERS);
    if (me) setView(homeView(me, PEOPLE));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  const lobs = useMemo(() => [...new Set(projects.map((p) => p.lob))].sort(), [projects]);
  const partners = useMemo(() => [...new Set(projects.map((p) => p.partner))].sort(), [projects]);
  const brands = useMemo(() => [...new Set(projects.map((p) => p.brand).filter((b): b is string => !!b))].sort(), [projects]);
  const myProjectCount = useMemo(() => (me ? projects.filter((p) => isMine(me, p)).length : 0), [projects, me]);
  const mySubCount = useMemo(() => (me ? projects.flatMap((p) => p.subtasks.filter((s) => s.assigneeId === me.id && !s.done)).length : 0), [projects, me]);
  const myCount = myProjectCount + mySubCount;
  const escalationOf = (p: Project) =>
    p.stage !== "live" && (openLeadershipNote(p) || p.blocked || overdueInfo(p.sacrosanctGoLive, p.targetGoLive, false).overdue ||
      aging(daysBetween(p.stageEnteredAt), STAGE_BY_ID[p.stage].slaDays) === "breach");

  if (!me) {
    if (isCloud) {
      if (cloudAuth.status === "no_access") return <CloudNoAccess email={cloudAuth.email} />;
      if (cloudAuth.status === "loading") return <CloudLoginLoading />;
      return <CloudLogin />;
    }
    return <Login onPick={(id) => { setMeId(id); localStorage.setItem("gtp_me", id); setView(homeView(PEOPLE_BY_ID[id], PEOPLE)); }} />;
  }

  const nav = navFor(me, PEOPLE);
  const active = nav.includes(view) ? view : homeView(me, PEOPLE);
  const m = META[active];
  const openCandidate = openId ? projects.find((p) => p.id === openId) : null;
  const canOpen = (p: Project) => hasGlobalView(me) || visibleTo(me, p) || subtreeVisibleTo(p, orgSubtreeIds(me, PEOPLE));
  const open = openCandidate && canOpen(openCandidate) ? openCandidate : null;  // RLS guard: never open what you can't see
  const showFilters = active === "board" || active === "list" || active === "team";

  // base data set per view (role scoping happens HERE, enforced server-side
  // too — this is just the matching UI scope): overseers and global-view
  // grantees see the whole portfolio; everyone else sees their normal
  // involvement-scoped slice PLUS their org-hierarchy subtree, if they have
  // one (a leaf with no reports just gets their own slice back — additive,
  // never narrower — see roles.ts's orgSubtreeIds/subtreeVisibleTo).
  const base = hasGlobalView(me) ? projects
    : projects.filter((p) => visibleTo(me, p) || subtreeVisibleTo(p, orgSubtreeIds(me, PEOPLE)));
  const filtered = applyFilters(base, filters);
  const escCount = base.filter(escalationOf).length;

  const badge = (k: ViewKey) => (k === "queue" ? myCount : k === "escalations" ? escCount : 0);
  const myFlagged = me ? projects.some((p) => isMine(me, p) && openLeadershipNote(p)) : false;
  const hotBadge = (k: ViewKey) => (k === "escalations" && escCount > 0) || (k === "queue" && myFlagged);

  return (
    <div className={`app ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
        <div className="brand" style={{ flexDirection: "column", alignItems: collapsed ? "center" : "flex-start", gap: 5 }}>
          {collapsed ? <div className="brand-mark">G</div> : <GyftrLogo h={22} />}
          <span className="nav-label" style={{ fontSize: 10.5, color: "var(--ink-mute)", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", paddingLeft: 2 }}>Tech · Project Flow</span>
        </div>

        {nav.map((k) => {
          const it = META[k]; const b = badge(k);
          return (
            <button key={k} className={`nav-item ${active === k ? "on" : ""}`} title={collapsed ? it.label : undefined}
              onClick={() => { setView(k); setFilters(EMPTY_FILTERS); }}>
              <it.Icon size={17} /> <span className="nav-label">{it.label}</span>
              {b ? <span className={`badge ${hotBadge(k) ? "hot" : ""}`}>{b}</span> : null}
            </button>
          );
        })}

        <div className="nav-sep">{collapsed ? "·" : "Data"}</div>
        <div className="nav-item" style={{ cursor: "default" }} title={collapsed ? (isCloud ? "Supabase" : "Local demo") : undefined}>
          {isCloud ? <Cloud size={16} /> : <HardDrive size={16} />} <span className="nav-label">{isCloud ? "Supabase" : "Local demo"}</span>
        </div>
        {!isCloud && (
          <button className="nav-item" title={collapsed ? "Reset demo" : undefined} onClick={() => { if (confirm("Reset demo data?")) resetDemo(); }}>
            <RotateCcw size={16} /> <span className="nav-label">Reset demo</span>
          </button>
        )}

        <div style={{ flex: 1 }} />

        <button className="nav-item" style={{ justifyContent: collapsed ? "center" : "flex-start" }} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggleCollapsed}>
          {collapsed ? <PanelLeftOpen size={17} /> : <><PanelLeftClose size={17} /> <span className="nav-label">Collapse</span></>}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 11px", borderTop: "1px solid var(--line)", marginTop: 6 }}>
          <Avatar id={me.id} size={32} />
          <div className="nav-label" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.name}</div>
            <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{TEAMS[me.team].label} · {me.role}</div>
          </div>
          {!collapsed && (
            <button className="icon-btn" style={{ width: 30, height: 30 }} title={isCloud ? "Sign out" : "Switch user"}
              onClick={() => { if (isCloud) { signOutCloud(); } else { setMeId(null); localStorage.removeItem("gtp_me"); } }}>
              <LogOut size={15} />
            </button>
          )}
        </div>
      </aside>

      <main className="main">
        {open ? (
          <Drawer project={open} me={me} onClose={() => setOpenId(null)} />
        ) : (
          <>
            <div className="topbar">
              <div>
                <div className="crumb">Gyftr Tech Portal · {TEAMS[me.team].label}</div>
                <h1>{active === "team" ? `My Projects · ${TEAMS[me.team].label}` : m.h}</h1>
                <div className="sub">{m.s}</div>
              </div>
              <div className="spacer" />
              {isReadOnly(me) && <span className="chip"><Eye size={12} /> Read-only observer</span>}
              {can("create", me) && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} /> New project</button>}
            </div>

            {showFilters && <FilterBar filters={filters} setFilters={setFilters} lobs={lobs} partners={partners} brands={brands} />}

            <div className="content">
              {active === "queue" && <MyQueue projects={projects} me={me} onOpen={setOpenId} />}
              {active === "team" && <Board projects={filtered} me={me} onOpen={setOpenId} />}
              {active === "overview" && <Dashboard projects={base} me={me} onOpen={setOpenId} />}
              {active === "board" && <Board projects={filtered} me={me} onOpen={setOpenId} />}
              {active === "list" && <TableView projects={filtered} onOpen={setOpenId} />}
              {active === "escalations" && <Escalations projects={base} onOpen={setOpenId} />}
            </div>
          </>
        )}
      </main>

      {creating && <CreateModal meId={me.id} partners={partners} brands={brands} onClose={(id) => { setCreating(false); if (id) setOpenId(id); }} />}
      <Toasts />
    </div>
  );
}
