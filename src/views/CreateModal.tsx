import { useState } from "react";
import { X } from "lucide-react";
import { createProject } from "../store";

/** A select of known values with an inline "+ Add new" escape hatch — used for
 *  Partner and Brand, which the CEO wants as pick-lists, not free text, but a
 *  new partner/brand has to be enterable the first time it comes up. */
function PickOrAdd({
  label, value, onChange, options, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; options: string[]; placeholder: string }) {
  const [custom, setCustom] = useState(options.length === 0);
  if (custom) {
    return (
      <div className="field">
        <label>{label} *</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
          {options.length > 0 && (
            <button type="button" className="btn sm" style={{ flex: "none" }} onClick={() => { setCustom(false); onChange(""); }}>List</button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="field">
      <label>{label} *</label>
      <select
        className="select" value={value}
        onChange={(e) => (e.target.value === "__new__" ? (setCustom(true), onChange("")) : onChange(e.target.value))}
      >
        <option value="">Select…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value="__new__">+ Add new…</option>
      </select>
    </div>
  );
}

export function CreateModal({ meId, partners, brands, onClose }: {
  meId: string; partners: string[]; brands: string[]; onClose: (createdId?: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [brd, setBrd] = useState("");
  const [partner, setPartner] = useState("");
  const [brand, setBrand] = useState("");
  const [lob, setLob] = useState("Channel Program");
  const [target, setTarget] = useState("");
  const valid = title.trim() && partner.trim();

  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const p = await createProject({
        title: title.trim(), brd: brd.trim(), partner: partner.trim(), brand: brand.trim() || null, lob,
        // Raised by is always whoever's logged in, not a picker — and the ball
        // starts with them too, since they're the one who just raised it.
        businessOwnerId: meId, ownerId: meId,
        priority: "P1", bifurcation: "B2C",
        stage: "intake", status: "business_clarification", blocked: false,
        targetGoLive: target || null, sacrosanctGoLive: null,
        priorityMonth: null, timelineEta: null, devEffortDays: null, reasonForDelay: null,
        productSpocId: null, techLeadId: null,
      });
      onClose(p.id);
    } catch (err) {
      setSaving(false);
      alert(err instanceof Error ? err.message : "Failed to create project.");
    }
  }

  return (
    <div className="modal-wrap" onClick={() => onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>New project</h2>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>Raises against you — it enters at Intake.</div>
          </div>
          <button className="icon-btn" style={{ marginLeft: "auto", width: 32, height: 32 }} onClick={() => onClose()}><X size={16} /></button>
        </div>
        <div style={{ padding: 20 }}>
          <div className="field">
            <label>Title *</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Addition of Bill Payments to Godrej catalogue" autoFocus />
          </div>
          <div className="field">
            <label>Requirement / BRD</label>
            <textarea className="input" value={brd} onChange={(e) => setBrd(e.target.value)} placeholder="What does the business need and why?" />
          </div>
          <div className="row">
            <PickOrAdd label="Partner" value={partner} onChange={setPartner} options={partners} placeholder="Godrej" />
            <PickOrAdd label="Brand" value={brand} onChange={setBrand} options={brands} placeholder="Club One" />
          </div>
          <div className="row">
            <div className="field">
              <label>Line of Business</label>
              <select className="select" value={lob} onChange={(e) => setLob(e.target.value)}>
                {["Channel Program", "Banking", "LLC", "Aggregators", "Other"].map((x) => <option key={x}>{x}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Target go-live</label>
              <input className="input" type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn" onClick={() => onClose()}>Cancel</button>
            <button className="btn primary" disabled={!valid || saving} style={{ opacity: valid && !saving ? 1 : .5 }} onClick={submit}>{saving ? "Creating…" : "Create project"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
