/* ─── Cloud auth — real Cognito accounts (email + password), replacing the
   old Supabase-backed demo profile picker. A fresh account is provisioned in
   FORCE_CHANGE_PASSWORD; authenticateUser() answers with a NEW_PASSWORD_REQUIRED
   challenge instead of a session, so there is no token — and nothing to render
   the board with — until the person sets a real password. See
   gyftr-ceo-portal/frontend/src/lib/cognito.js, which this mirrors closely.

   No-op (state stays "signed_out") when Cognito isn't configured — i.e. local
   demo mode (see lib.ts's isCloud). ─── */
import { useEffect, useState } from "react";
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";
import { isCloud } from "./lib";
import { fetchMe } from "./api";
import { loadPeople, resetPeopleCache } from "./people";
import type { Person } from "./types";

// .com is a real, intentional second domain for part of the org (the
// Senior/Junior/Sub Junior hierarchy roster), not a typo — both are valid.
const ALLOWED_DOMAINS = ["gyftr.net", "gyftr.com"];

export function isAllowedEmail(email: string): boolean {
  const lower = email.trim().toLowerCase();
  return ALLOWED_DOMAINS.some((d) => lower.endsWith(`@${d}`));
}

function createUserPool(): CognitoUserPool | null {
  const UserPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
  const ClientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  if (!UserPoolId || !ClientId) return null;
  try {
    return new CognitoUserPool({ UserPoolId, ClientId });
  } catch (err) {
    console.error("[auth] Cognito pool could not be created:", (err as Error).message);
    return null;
  }
}

const userPool = createUserPool();

/** Holds the in-progress NEW_PASSWORD_REQUIRED challenge between signIn()
 *  resolving `mustChangePassword` and the caller submitting a new password. */
let pendingChallenge: { user: CognitoUser; userAttributes: Record<string, string> } | null = null;

/** Returns a currently-valid ID token, refreshing from the refresh token if
 *  the cached one has expired — this is what api.ts calls on every request
 *  so a session doesn't go stale after an hour of use. Null if signed out. */
export function getIdToken(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!userPool) return resolve(null);
    const user = userPool.getCurrentUser();
    if (!user) return resolve(null);
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) return resolve(null);
      resolve(session.getIdToken().getJwtToken());
    });
  });
}

type SignInResult = { ok: true } | { mustChangePassword: true; email: string } | { ok: false; error: string };

/** Sign in with email + password. Resolves `mustChangePassword` on a first
 *  login (temp-password-forced-reset); callers must check for it before
 *  treating the result as a successful sign-in. */
export function signIn(email: string, password: string): Promise<SignInResult> {
  return new Promise((resolve) => {
    if (!userPool) return resolve({ ok: false, error: "Cloud mode is off." });
    if (!isAllowedEmail(email)) {
      return resolve({ ok: false, error: `Use your @${ALLOWED_DOMAINS.join(" or @")} email address.` });
    }
    const user = new CognitoUser({ Username: email.trim().toLowerCase(), Pool: userPool });
    const details = new AuthenticationDetails({ Username: email.trim().toLowerCase(), Password: password });

    user.authenticateUser(details, {
      onSuccess: () => {
        pendingChallenge = null;
        resolve({ ok: true });
      },
      onFailure: (err) => resolve({ ok: false, error: err.message || "Sign-in failed." }),
      newPasswordRequired: (userAttributes, requiredAttributes) => {
        // Send back ONLY attributes Cognito says are still required, never a
        // standard attribute that's already set — echoing e.g. `email` back
        // makes Cognito fail the challenge with "Cannot modify an already
        // provided email", which blocks every first login.
        const NEVER_SEND = new Set(["email", "email_verified", "phone_number", "phone_number_verified", "sub"]);
        const payload: Record<string, string> = {};
        for (const name of requiredAttributes || []) {
          if (!NEVER_SEND.has(name) && userAttributes?.[name] !== undefined) payload[name] = userAttributes[name];
        }
        pendingChallenge = { user, userAttributes: payload };
        resolve({ mustChangePassword: true, email: email.trim().toLowerCase() });
      },
    });
  });
}

/** Completes a first login's forced password-change challenge. */
export function completeNewPassword(newPassword: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (!pendingChallenge) return resolve({ ok: false, error: "No password challenge in progress — sign in again." });
    const { user, userAttributes } = pendingChallenge;
    user.completeNewPasswordChallenge(newPassword, userAttributes, {
      onSuccess: () => { pendingChallenge = null; resolve({ ok: true }); },
      onFailure: (err) => resolve({ ok: false, error: err.message || "Couldn't set that password." }),
    });
  });
}

export function signOutCloud() {
  userPool?.getCurrentUser()?.signOut();
  resetPeopleCache();
  authListeners.forEach((l) => l({ type: "signed_out" }));
}

/* ── A tiny pub/sub so cloudStore.ts can hook sign-in/sign-out without a
   circular import on App.tsx/useCloudAuth's React state, and so CloudLogin
   can push the must-set-password step into the top-level AuthState. ── */
type AuthEvent = { type: "signed_in" } | { type: "signed_out" } | { type: "must_set_password"; email: string };
const authListeners = new Set<(e: AuthEvent) => void>();
export function onAuthEvent(fn: (e: AuthEvent) => void): () => void {
  authListeners.add(fn);
  return () => { authListeners.delete(fn); };
}

/** CloudLogin calls this once signIn() resolves `mustChangePassword`, so the
 *  top-level AuthState (and therefore App.tsx) reflects the forced
 *  password-change step instead of staying on the plain sign-in screen. */
export function notifyMustSetPassword(email: string) {
  authListeners.forEach((l) => l({ type: "must_set_password", email }));
}

export type AuthState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; me: Person }
  | { status: "no_access"; email: string }
  | { status: "must_set_password"; email: string };

/** Drives the cloud login lifecycle: Cognito session → GET /api/me → app-ready Person. */
export function useCloudAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    if (!isCloud || !userPool) { setState({ status: "signed_out" }); return; }
    let cancelled = false;

    async function resolveFromToken() {
      const token = await getIdToken();
      if (cancelled) return;
      if (!token) { setState({ status: "signed_out" }); return; }
      try {
        await loadPeople();
        const me = await fetchMe();
        if (cancelled) return;
        setState({ status: "signed_in", me });
      } catch (err) {
        if (cancelled) return;
        // A valid Cognito token with no linked `people` row is a real state
        // (loadIdentity's 403), not a loading failure — surface it plainly.
        console.warn("[auth] could not load profile:", (err as Error).message);
        const user = userPool!.getCurrentUser();
        setState({ status: "no_access", email: user?.getUsername() ?? "" });
      }
    }

    resolveFromToken();
    const unsubscribe = onAuthEvent((e) => {
      if (cancelled) return;
      if (e.type === "signed_in") resolveFromToken();
      else if (e.type === "must_set_password") setState({ status: "must_set_password", email: e.email });
      else setState({ status: "signed_out" });
    });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  return state;
}

/** Called by the login screen once signIn()/completeNewPassword() resolves a
 *  real session, so useCloudAuth() re-resolves immediately instead of
 *  waiting on the next poll/render. */
export function notifySignedIn() {
  authListeners.forEach((l) => l({ type: "signed_in" }));
}
