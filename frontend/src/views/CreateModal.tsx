import { useState } from "react";
import { X, Paperclip } from "lucide-react";
import { createProject, addAttachment } from "../store";
import type { DocKind } from "../types";

const DOC_KINDS: DocKind[] = ["BRD", "PRD", "Figma", "HTML", "Doc"];

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

  // Requirement docs (BRD, Figma links, etc.) attached while raising the
  // project — held locally until the project actually exists, since
  // attachments need a real project id, then flushed right after create.
  const [pendingDocs, setPendingDocs] = useState<{ name: string; kind: DocKind; url: string }[]>([]);
  const [docKind, setDocKind] = useState<DocKind>("BRD");
  const [docName, setDocName] = useState("");
  const [docUrl, setDocUrl] = useState("");

  function addDoc() {
    if (!docName.trim()) return;
    setPendingDocs((docs) => [...docs, { name: docName.trim(), kind: docKind, url: docUrl.trim() }]);
    setDocName(""); setDocUrl("");
  }
  function removeDoc(i: number) {
    setPendingDocs((docs) => docs.filter((_, x) => x !== i));
  }

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
      for (const doc of pendingDocs) addAttachment(p.id, meId, doc.name, doc.kind, doc.url || undefined);
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
            {pendingDocs.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
                {pendingDocs.map((doc, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>
                    <span className="pill" style={{ background: "var(--pop-soft)", color: "var(--pop-deep)", flex: "none" }}>{doc.kind}</span>
                    <span style={{ flex: 1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</span>
                    <button type="button" className="icon-btn" style={{ width: 20, height: 20, flex: "none" }} onClick={() => removeDoc(i)}><X size={11} /></button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <select className="select sm" style={{ flex: "none" }} value={docKind} onChange={(e) => setDocKind(e.target.value as DocKind)}>
                {DOC_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <input className="input" style={{ flex: 1 }} placeholder="Label (e.g. Godrej BRD)…" value={docName} onChange={(e) => setDocName(e.target.value)} />
              <input className="input" style={{ flex: 1 }} placeholder="https://link…" value={docUrl} onChange={(e) => setDocUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDoc())} />
              <button type="button" className="btn sm" style={{ flex: "none" }} onClick={addDoc}><Paperclip size={12} /> Add</button>
            </div>
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
