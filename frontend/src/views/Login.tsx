import { ChevronRight } from "lucide-react";
import { PEOPLE } from "../people";
import { TEAMS } from "../workflow";
import { Avatar } from "../ui";
import { GyftrLogo } from "../GyftrLogo";

/** Local demo mode only — pick who you are, no real auth. */
export function Login({ onPick }: { onPick: (id: string) => void }) {
  const featured = ["u_ceo", "u_anjali", "u_sid", "u_harshita", "u_raj", "u_pooja"].filter((id) => PEOPLE.some((p) => p.id === id));
  return (
    <div className="login">
      <div className="login-card">
        <GyftrLogo h={30} />
        <div style={{ fontFamily: "var(--font-d)", fontSize: 17, fontWeight: 700, marginTop: 12, letterSpacing: "-.02em" }}>Tech Project Portal</div>
        <p style={{ fontSize: 12.5, color: "var(--ink-mute)", margin: "3px 0 18px" }}>
          Project flow · one source of truth. Pick who you are — every action is logged against you.
        </p>
        <div className="user-pick-list">
          {featured.map((id) => {
            const p = PEOPLE.find((x) => x.id === id)!;
            return (
              <button key={id} className="user-pick" onClick={() => onPick(id)}>
                <Avatar id={id} size={32} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 650, fontSize: 13 }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{TEAMS[p.team].label} · {p.role}</div>
                </div>
                <ChevronRight size={16} color="var(--ink-mute)" />
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 14, textAlign: "center" }}>
          Tip: open a second browser tab as a different person — changes sync live between them.
        </p>
      </div>
    </div>
  );
}
