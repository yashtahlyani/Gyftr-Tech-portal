import { Search, X, Ban, AlertOctagon } from "lucide-react";
import type { Project } from "../types";
import { STATUS_LIST } from "../workflow";
import { overdueInfo } from "../lib";
import { PEOPLE } from "../people";

export interface Filters {
  q: string; lob: string; partner: string; brand: string; priority: string; status: string; owner: string;
  blocked: boolean; overdue: boolean;
}

export const EMPTY_FILTERS: Filters = { q: "", lob: "all", partner: "all", brand: "all", priority: "all", status: "all", owner: "all", blocked: false, overdue: false };

export function isFiltering(f: Filters): boolean {
  return f.q !== "" || f.lob !== "all" || f.partner !== "all" || f.brand !== "all" || f.priority !== "all" || f.status !== "all" || f.owner !== "all" || f.blocked || f.overdue;
}

export function applyFilters(projects: Project[], f: Filters): Project[] {
  const q = f.q.trim().toLowerCase();
  return projects.filter((p) => {
    if (q && !`${p.code} ${p.title} ${p.partner} ${p.brand ?? ""} ${p.lob}`.toLowerCase().includes(q)) return false;
    if (f.lob !== "all" && p.lob !== f.lob) return false;
    if (f.partner !== "all" && p.partner !== f.partner) return false;
    if (f.brand !== "all" && p.brand !== f.brand) return false;
    if (f.priority !== "all" && p.priority !== f.priority) return false;
    if (f.status !== "all" && p.status !== f.status) return false;
    if (f.owner !== "all" && p.ownerId !== f.owner) return false;
    if (f.blocked && !p.blocked) return false;
    if (f.overdue && !overdueInfo(p.sacrosanctGoLive, p.targetGoLive, p.stage === "live").overdue) return false;
    return true;
  });
}

export function FilterBar({ filters, setFilters, lobs, partners, brands }: {
  filters: Filters; setFilters: (f: Filters) => void; lobs: string[]; partners: string[]; brands: string[];
}) {
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  return (
    <div className="filterbar">
      <div className="search">
        <Search size={15} color="var(--ink-mute)" />
        <input value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search projects, partners, brands, LOB…" />
      </div>
      <select className="fsel" value={filters.partner} onChange={(e) => set({ partner: e.target.value })}>
        <option value="all">All Partners</option>
        {partners.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <select className="fsel" value={filters.brand} onChange={(e) => set({ brand: e.target.value })}>
        <option value="all">All Brands</option>
        {brands.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select className="fsel" value={filters.lob} onChange={(e) => set({ lob: e.target.value })}>
        <option value="all">All LOBs</option>
        {lobs.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
      <select className="fsel" value={filters.priority} onChange={(e) => set({ priority: e.target.value })}>
        <option value="all">Any priority</option>
        <option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option>
      </select>
      <select className="fsel" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
        <option value="all">Any status</option>
        {STATUS_LIST.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <select className="fsel" value={filters.owner} onChange={(e) => set({ owner: e.target.value })}>
        <option value="all">Anyone</option>
        {PEOPLE.filter((p) => p.role !== "leadership").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className={`ftoggle ${filters.blocked ? "on" : ""}`} onClick={() => set({ blocked: !filters.blocked })}>
        <Ban size={13} /> Blocked
      </button>
      <button className={`ftoggle ${filters.overdue ? "on" : ""}`} onClick={() => set({ overdue: !filters.overdue })}>
        <AlertOctagon size={13} /> Overdue
      </button>
      {isFiltering(filters) && (
        <button className="btn ghost sm" onClick={() => setFilters(EMPTY_FILTERS)}><X size={13} /> Clear</button>
      )}
    </div>
  );
}
