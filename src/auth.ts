/* ─── Cloud auth — demo profile picker, backed by real Supabase sessions.
   RLS is keyed off auth.uid(), so every "profile" is still a genuine signed-in
   session under the hood (one shared demo password) — picking a name just
   skips typing credentials. Swap in real per-user passwords / SSO before
   this is anything but a demo. No-op in local demo mode. ─── */
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, isCloud } from "./lib";
import { loadPeople } from "./people";
import type { Person } from "./types";

const ALLOWED_DOMAIN = "gyftr.net";
const DEMO_PASSWORD = "GyftrTech@2026";

export function isAllowedEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

/** Sign in (or switch) to a profile by email — one click, no password prompt. */
export async function switchProfile(email: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Cloud mode is off." };
  if (!isAllowedEmail(email)) return { ok: false, error: `Use your @${ALLOWED_DOMAIN} email address.` };
  await supabase.auth.signOut();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: DEMO_PASSWORD });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signOutCloud() {
  if (supabase) await supabase.auth.signOut();
}

async function claimPerson(): Promise<Person | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("claim_person");
  if (error) { console.error("claim_person failed:", error.message); return null; }
  const row = (Array.isArray(data) ? data[0] : data) as
    { id: string; name: string; team: Person["team"]; role: Person["role"]; email: string } | null;
  if (!row?.id) return null;
  return { id: row.id, name: row.name, team: row.team, role: row.role, email: row.email };
}

export type AuthState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; me: Person }
  | { status: "no_access"; email: string };

/** Drives the cloud login lifecycle: session → directory row → app-ready Person. */
export function useCloudAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    if (!isCloud || !supabase) { setState({ status: "signed_out" }); return; }
    let cancelled = false;
    const client = supabase;

    async function resolve(session: Session | null) {
      if (!session) { if (!cancelled) setState({ status: "signed_out" }); return; }
      await loadPeople();
      const me = await claimPerson();
      if (cancelled) return;
      setState(me ? { status: "signed_in", me } : { status: "no_access", email: session.user.email ?? "" });
    }

    client.auth.getSession().then(({ data }) => resolve(data.session));
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => resolve(session));
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  return state;
}
