/* ─── Cloud auth — demo profile picker, backed by real Cognito sessions.
   Every "profile" is still a genuine signed-in session under the hood (one
   shared password for every account), so picking a name just skips typing
   credentials — same UX as the Supabase version, different auth provider.
   No-op in local demo mode. ─── */
import { useEffect, useState } from "react";
import {
  CognitoUserPool, CognitoUser, AuthenticationDetails, type CognitoUserSession,
} from "amazon-cognito-identity-js";
import { isCloud } from "./lib";
import { setAuthToken, get } from "./api";
import type { Person } from "./types";

const ALLOWED_DOMAIN = "gyftr.net";
const DEMO_PASSWORD = "default@123";

const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;
const pool = userPoolId && clientId ? new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId }) : null;

export function isAllowedEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

// amazon-cognito-identity-js has no onAuthStateChange like Supabase — every
// useCloudAuth() instance subscribes here, and switchProfile()/signOutCloud()
// ping it after changing the session so the app re-resolves immediately
// instead of waiting for the next mount.
const listeners = new Set<() => void>();
function notifyAuthChanged() { listeners.forEach((l) => l()); }

/** For cloudStore.ts — refetch immediately on sign-in/out instead of waiting for the next poll. */
export function subscribeAuthChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function authenticate(email: string, password: string): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    if (!pool) return reject(new Error("Cloud mode is off."));
    const cognitoUser = new CognitoUser({ Username: email, Pool: pool });
    const details = new AuthenticationDetails({ Username: email, Password: password });
    cognitoUser.authenticateUser(details, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
    });
  });
}

/** Sign in (or switch) to a profile by email — one click, no password prompt. */
export async function switchProfile(email: string): Promise<{ ok: boolean; error?: string }> {
  if (!pool) return { ok: false, error: "Cloud mode is off." };
  if (!isAllowedEmail(email)) return { ok: false, error: `Use your @${ALLOWED_DOMAIN} email address.` };
  try {
    await signOutCloud();
    const session = await authenticate(email.trim().toLowerCase(), DEMO_PASSWORD);
    setAuthToken(session.getIdToken().getJwtToken());
    notifyAuthChanged();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign-in failed." };
  }
}

export async function signOutCloud() {
  setAuthToken(null);
  pool?.getCurrentUser()?.signOut();
  notifyAuthChanged();
}

export type AuthState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; me: Person }
  | { status: "no_access"; email: string };

function restoreSession(): Promise<CognitoUserSession | null> {
  return new Promise((resolve) => {
    const current = pool?.getCurrentUser();
    if (!current) return resolve(null);
    current.getSession((err: Error | null, session: CognitoUserSession | null) => {
      resolve(err ? null : session);
    });
  });
}

/** Drives the cloud login lifecycle: session → /api/me → app-ready Person. */
export function useCloudAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    if (!isCloud || !pool) { setState({ status: "signed_out" }); return; }
    let cancelled = false;

    async function resolve() {
      const session = await restoreSession();
      if (!session || !session.isValid()) { if (!cancelled) setState({ status: "signed_out" }); return; }
      setAuthToken(session.getIdToken().getJwtToken());
      const email = session.getIdToken().payload.email as string | undefined;
      try {
        const me = await get<Person>("/api/me");
        if (!cancelled) setState({ status: "signed_in", me });
      } catch {
        if (!cancelled) setState({ status: "no_access", email: email ?? "" });
      }
    }

    resolve();
    listeners.add(resolve);
    return () => { cancelled = true; listeners.delete(resolve); };
  }, []);

  return state;
}
