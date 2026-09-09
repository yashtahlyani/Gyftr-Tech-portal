import { useState } from "react";
import { ShieldAlert, Loader2, Eye, EyeOff } from "lucide-react";
import { GyftrLogo } from "../GyftrLogo";
import { signIn, completeNewPassword, signOutCloud, notifySignedIn, notifyMustSetPassword } from "../auth";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="login">
      <div className="login-card">
        <GyftrLogo h={30} />
        <div style={{ fontFamily: "var(--font-d)", fontSize: 17, fontWeight: 700, marginTop: 12, letterSpacing: "-.02em" }}>Tech Project Portal</div>
        {children}
      </div>
    </div>
  );
}

export function CloudLoginLoading() {
  return (
    <Shell>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 22, color: "var(--ink-mute)", fontSize: 13 }}>
        <Loader2 size={16} className="spin" /> Checking your session…
      </div>
    </Shell>
  );
}

export function CloudNoAccess({ email }: { email: string }) {
  return (
    <Shell>
      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <ShieldAlert size={30} color="var(--rose-fg)" />
        <div style={{ fontSize: 13.5, fontWeight: 650 }}>No portal access for {email}</div>
        <p style={{ fontSize: 12.5, color: "var(--ink-mute)", margin: 0 }}>
          This account isn't provisioned in the org directory yet. Contact an admin to have your
          person record linked to this sign-in.
        </p>
        <button className="btn sm" onClick={() => signOutCloud()}>Back</button>
      </div>
    </Shell>
  );
}

/** A password field with a show/hide toggle — used by both the sign-in form
 *  and the forced "set a new password" step below. */
function PasswordField({ value, onChange, placeholder, autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        className="input" type={show ? "text" : "password"} placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus}
        style={{ width: "100%", paddingRight: 34 }}
      />
      <button
        type="button" onClick={() => setShow((s) => !s)} tabIndex={-1}
        title={show ? "Hide password" : "Show password"}
        style={{
          position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
          background: "none", border: "none", cursor: "pointer", color: "var(--ink-mute)", padding: 2,
        }}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

/** Real email + password sign-in (replaces the old "pick who you are"
 *  profile picker, which relied on active_people_directory() + one shared
 *  demo password — that RPC and concept are gone entirely). Handles the
 *  Cognito NEW_PASSWORD_REQUIRED / FORCE_CHANGE_PASSWORD first-login
 *  challenge by switching to a "set a new password" step in place. */
export function CloudLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once set, the form below switches to the forced password-change step
  // for this same in-progress Cognito challenge (see auth.ts's signIn()).
  const [mustChangeFor, setMustChangeFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const submitSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await signIn(email, password);
    setPending(false);
    if ("mustChangePassword" in res) {
      setMustChangeFor(res.email);
      notifyMustSetPassword(res.email);
      return;
    }
    if (!res.ok) setError(res.error);
    else notifySignedIn();
  };

  const submitNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setError("Passwords don't match."); return; }
    setPending(true);
    const res = await completeNewPassword(newPassword);
    setPending(false);
    if (!res.ok) setError(res.error ?? "Couldn't set that password.");
    else notifySignedIn();
  };

  if (mustChangeFor) {
    return (
      <Shell>
        <p style={{ fontSize: 12.5, color: "var(--ink-mute)", margin: "3px 0 14px" }}>
          First sign-in for <strong>{mustChangeFor}</strong> — set a new password to continue.
        </p>
        <form onSubmit={submitNewPassword} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <PasswordField value={newPassword} onChange={setNewPassword} placeholder="New password" autoFocus />
          <PasswordField value={confirmPassword} onChange={setConfirmPassword} placeholder="Confirm new password" />
          {error && <div style={{ fontSize: 12, color: "var(--rose-fg)" }}>{error}</div>}
          <button className="btn primary" type="submit" disabled={pending} style={{ justifyContent: "center" }}>
            {pending ? <Loader2 size={15} className="spin" /> : "Set password & continue"}
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      <p style={{ fontSize: 12.5, color: "var(--ink-mute)", margin: "3px 0 14px" }}>
        Sign in with your Gyftr email to continue.
      </p>
      <form onSubmit={submitSignIn} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          className="input" type="email" placeholder="you@gyftr.net" value={email}
          onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username"
          style={{ width: "100%" }}
        />
        <PasswordField value={password} onChange={setPassword} placeholder="Password" />
        {error && <div style={{ fontSize: 12, color: "var(--rose-fg)" }}>{error}</div>}
        <button className="btn primary" type="submit" disabled={pending || !email || !password} style={{ justifyContent: "center" }}>
          {pending ? <Loader2 size={15} className="spin" /> : "Sign in"}
        </button>
      </form>
    </Shell>
  );
}
