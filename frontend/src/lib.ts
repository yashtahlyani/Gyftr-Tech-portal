/* ─── Small shared helpers ─── */
import type { Person } from "./types";
import { TEAMS } from "./workflow";

/** "Name (what they do)" — department if set (e.g. "E-Pay"), else the team
 *  label, plus a short role qualifier for leads/SVPs/PMO. Used everywhere a
 *  person picker/filter needs more than a bare name to disambiguate a large
 *  pool (Drawer.tsx's pickers, FilterBar.tsx's owner filter). */
export function personLabel(p: Person): string {
  const area = p.department || TEAMS[p.team].label;
  const roleShort = p.role === "svp" ? "SVP" : p.role === "lead" ? "Lead" : p.role === "pmo" ? "PMO" : "";
  const bracket = [area, roleShort].filter(Boolean).join(" · ");
  return bracket ? `${p.name} (${bracket})` : p.name;
}

/** True once Cognito is configured (VITE_COGNITO_USER_POOL_ID/CLIENT_ID set)
 *  — the AWS-backed app, hitting api.ts/cloudStore.ts. False falls back to
 *  the local-demo store (localStore.ts) for offline/dev-without-AWS work.
 *  Fixed for the whole session, same as the old Supabase-env-based check. */
export const isCloud =
  !!(import.meta.env.VITE_COGNITO_USER_POOL_ID && import.meta.env.VITE_COGNITO_CLIENT_ID);

export const DAY = 86_400_000;
export const now = () => Date.now();
export const TODAY = new Date();

/** Overdue = committed/target date has passed and it isn't live yet. */
export function overdueInfo(sacrosanct: string | null, target: string | null, isLive: boolean) {
  if (isLive) return { overdue: false, days: 0 };
  const ref = sacrosanct || target;
  if (!ref) return { overdue: false, days: 0 };
  const d = Math.floor((TODAY.getTime() - new Date(ref).getTime()) / DAY);
  return { overdue: d > 0, days: d };
}

export function daysBetween(from: number, to: number = Date.now()): number {
  return Math.max(0, Math.floor((to - from) / DAY));
}

export function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

export function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

let _n = 0;
export const uid = (p = "id") => `${p}_${Date.now().toString(36)}_${(_n++).toString(36)}`;

/** Deterministic avatar color from a string. */
export function colorFor(seed: string): string {
  const palette = ["#0EA5E9", "#8B5CF6", "#F59E0B", "#10B981", "#EC4899", "#6366F1", "#F43F5E", "#14B8A6"];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
