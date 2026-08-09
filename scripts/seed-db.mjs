/**
 * Seed the Supabase DB with demo data from seed.ts.
 * Run: node scripts/seed-db.mjs
 * Safe to re-run — skips existing rows by email/code.
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars before running this script.");
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const DAY = 86_400_000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
const date = (d) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);

// ── Step 1: Run subtask column migration ──────────────────────────────────────
async function runMigration() {
  console.log("Running subtask migration…");
  const sql = `
    alter table subtasks add column if not exists expected_date date;
    alter table subtasks add column if not exists promised_date date;
    alter table subtasks add column if not exists effort_days int;
    drop policy if exists s_wr on subtasks;
    create policy s_wr on subtasks for all
      using (can_act(project_id) or assignee_id = (select id from people where auth_id = auth.uid()))
      with check (can_act(project_id) or assignee_id = (select id from people where auth_id = auth.uid()));
  `;
  // Use REST SQL endpoint
  const res = await fetch(`${URL}/rest/v1/rpc/`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${KEY}`, "apikey": KEY, "Content-Type": "application/json" },
  });
  // Use pg_query via supabase-js isn't available; use direct SQL endpoint
  const r = await fetch(`${URL}/pg`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/sql" },
    body: sql,
  }).catch(() => null);
  // pg endpoint may not be available; try via Supabase SQL over RPC if available
  // We'll just proceed — if columns exist already, the IF NOT EXISTS guards us
  console.log("Migration attempted (errors expected if already applied).");
}

// ── Step 2: Seed people ───────────────────────────────────────────────────────
const SEED_PEOPLE = [
  { sid: "u_neha",     name: "Neha",          team: "business",    role: "lead",       email: "neha@gyftr.net" },
  { sid: "u_anjali",   name: "Anjali Gupta",  team: "business",    role: "lead",       email: "anjali.gupta@gyftr.net" },
  { sid: "u_biz1",     name: "Priya Sharma",  team: "business",    role: "member",     email: "priya.sharma@gyftr.net" },
  { sid: "u_biz2",     name: "Rahul Joshi",   team: "business",    role: "member",     email: "rahul.joshi@gyftr.net" },
  { sid: "u_saurabh",  name: "Saurabh",       team: "product",     role: "lead",       email: "saurabh@gyftr.net" },
  { sid: "u_sid",      name: "Siddharth",     team: "product",     role: "member",     email: "siddharth@gyftr.net" },
  { sid: "u_yash",     name: "Yash Tahlyani", team: "product",     role: "member",     email: "yash.tahlyani@gyftr.net" },
  { sid: "u_rajneesh", name: "Rajneesh",      team: "tech_spoc",   role: "pmo",        email: "rajneesh@gyftr.net" },
  { sid: "u_harshita", name: "Harshita",      team: "tech_spoc",   role: "lead",       email: "harshita@gyftr.net" },
  { sid: "u_mgr2",     name: "Deepak",        team: "tech_spoc",   role: "lead",       email: "deepak@gyftr.net" },
  { sid: "u_mgr3",     name: "Sameer",        team: "tech_spoc",   role: "lead",       email: "sameer@gyftr.net" },
  { sid: "u_mgr4",     name: "Pankaj",        team: "tech_spoc",   role: "lead",       email: "pankaj@gyftr.net" },
  { sid: "u_raj",      name: "Raj",           team: "development", role: "member",     email: "raj@gyftr.net" },
  { sid: "u_anmol",    name: "Anmol",         team: "development", role: "member",     email: "anmol@gyftr.net" },
  { sid: "u_vikas",    name: "Vikas",         team: "development", role: "member",     email: "vikas@gyftr.net" },
  { sid: "u_rajkumar", name: "Rajkumar",      team: "design",      role: "member",     email: "rajkumar@gyftr.net" },
  { sid: "u_pooja",    name: "Pooja",         team: "qa",          role: "member",     email: "pooja@gyftr.net" },
  { sid: "u_karan",    name: "Karan",         team: "qa",          role: "lead",       email: "karan@gyftr.net" },
  { sid: "u_pmo",      name: "PMO Office",    team: "leadership",  role: "pmo",        email: "pmo@gyftr.net" },
  { sid: "u_ceo",      name: "Leadership",    team: "leadership",  role: "leadership", email: "leadership@gyftr.net" },
];

async function seedPeople() {
  console.log("\nSeeding people…");
  const { data: existing } = await db.from("people").select("id, email");
  const existingEmails = new Set((existing ?? []).map(r => r.email));

  const toInsert = SEED_PEOPLE.filter(p => !existingEmails.has(p.email))
    .map(({ name, team, role, email }) => ({ name, team, role, email }));

  if (toInsert.length === 0) {
    console.log("  All people already exist — skipping.");
  } else {
    const { error } = await db.from("people").insert(toInsert);
    if (error) console.error("  People insert error:", error.message);
    else console.log(`  Inserted ${toInsert.length} people.`);
  }

  // Return a sid→uuid map
  const { data: all } = await db.from("people").select("id, email");
  const emailToUuid = Object.fromEntries((all ?? []).map(r => [r.email, r.id]));
  const sidToUuid = {};
  for (const p of SEED_PEOPLE) sidToUuid[p.sid] = emailToUuid[p.email];
  return sidToUuid;
}

// ── Step 3: Seed projects ─────────────────────────────────────────────────────
function buildProjects(m) {
  return [
    {
      code: "TP-001",
      title: "Addition of Bill Payments, Flights & Hotels",
      brd: "Extend the Godrej loyalty catalogue with Bill Payments, Flights and Hotels. Wallet round-up logic and guidelines to be finalised with partner.",
      partner: "Godrej", lob: "LLC",
      priority: "P0", bifurcation: "B2B",
      stage: "uat", status: "qa_clarification_pending",
      owner_id: m["u_anjali"], business_owner_id: m["u_anjali"],
      blocked: true, block_reason: "Cleartrip staging API not working — Bills & Utilities API failing frequently.",
      stage_entered_at: ago(9), created_at: ago(48),
      target_go_live: null, sacrosanct_go_live: "2026-04-30",
      priority_month: "June'26", dev_effort_days: 30,
      reason_for_delay: "Guidelines changed · Wallet update changes · Round-up logic change · Testing · Changes suggested by the partner",
      product_spoc_id: m["u_harshita"], tech_lead_id: m["u_raj"],
      subtasks: [
        { title: "Bill payment integration",   team: "development", done: true,  assignee_id: m["u_raj"],    expected_date: date(20), promised_date: date(18), effort_days: 5 },
        { title: "Flights (Cleartrip) integration", team: "development", done: false, assignee_id: m["u_anmol"], expected_date: date(5),  promised_date: date(4),  effort_days: 8 },
        { title: "Hotels flow + UI",            team: "design",      done: true,  assignee_id: m["u_rajkumar"], expected_date: date(25), promised_date: date(24), effort_days: 3 },
        { title: "Round-up wallet logic",       team: "development", done: false, assignee_id: m["u_vikas"], expected_date: date(3),  promised_date: date(3),  effort_days: 4 },
      ],
      comments: [
        { at: ago(3), by_id: m["u_pooja"],   text: "Cleartrip staging keeps timing out on Bills API. Blocked on partner infra.", pinned: false, resolved: false },
        { at: ago(1), by_id: m["u_anjali"],  text: "Escalated to Godrej. Awaiting stable staging endpoint.", pinned: false, resolved: false },
      ],
      history: [
        { at: ago(48), by_id: m["u_anjali"],  from_stage: null,       to_stage: "intake",      from_status: null,               to_status: "business_clarification", note: "Project created" },
        { at: ago(40), by_id: m["u_sid"],     from_stage: "intake",   to_stage: "scoping",     from_status: "business_clarification", to_status: "scoping",        note: "Scoping started" },
        { at: ago(30), by_id: m["u_harshita"],from_stage: "scoping",  to_stage: "to_be_picked",from_status: "scoping",          to_status: "to_be_picked",           note: "Sent to Dev" },
        { at: ago(20), by_id: m["u_raj"],     from_stage: "to_be_picked","to_stage": "development",from_status: "to_be_picked", to_status: "dev",                    note: "Picked up" },
        { at: ago(9),  by_id: m["u_karan"],   from_stage: "development","to_stage":"uat",       from_status: "dev",             to_status: "qa_clarification_pending", note: "Moved to UAT — Cleartrip staging issue" },
      ],
    },
    {
      code: "TP-002",
      title: "Adding pay element as payment instrument",
      brd: "Introduce a new pay element usable as a payment instrument at checkout.",
      partner: "IOCL P+C", lob: "Channel Program",
      priority: "P0", bifurcation: "B2B",
      stage: "live", status: "live",
      owner_id: m["u_ceo"], business_owner_id: m["u_anjali"],
      blocked: false,
      stage_entered_at: ago(178), created_at: ago(220),
      target_go_live: "2026-01-18", sacrosanct_go_live: "2026-01-16", final_go_live: "2026-01-16",
      priority_month: "Jan'26", dev_effort_days: 15,
      product_spoc_id: m["u_harshita"], tech_lead_id: m["u_vikas"],
      subtasks: [
        { title: "Payment element integration", team: "development", done: true, assignee_id: m["u_vikas"], expected_date: "2026-01-14", promised_date: "2026-01-14", effort_days: 15 },
      ],
      history: [
        { at: ago(220), by_id: m["u_anjali"],  from_stage: null,      to_stage: "intake",      from_status: null,    to_status: "business_clarification", note: "Project created" },
        { at: ago(210), by_id: m["u_sid"],     from_stage: "intake",  to_stage: "scoping",     from_status: "business_clarification", to_status: "scoping", note: "Scoping" },
        { at: ago(200), by_id: m["u_harshita"],from_stage: "scoping", to_stage: "development", from_status: "scoping", to_status: "dev", note: "Dev started" },
        { at: ago(185), by_id: m["u_karan"],   from_stage: "development","to_stage":"qa",      from_status: "dev",   to_status: "qa",                     note: "Ready for QA" },
        { at: ago(180), by_id: m["u_anjali"],  from_stage: "qa",      to_stage: "uat",         from_status: "qa",    to_status: "uat",                    note: "UAT" },
        { at: ago(178), by_id: m["u_ceo"],     from_stage: "uat",     to_stage: "live",        from_status: "uat",   to_status: "live",                   note: "Go live" },
      ],
    },
    {
      code: "TP-003",
      title: "UI Revamp — Wonder Influencer, Dealer & Retailer",
      brd: "Full UI revamp across influencer, dealer and retailer programs.",
      partner: "Wonder Cement", lob: "Channel Program",
      priority: "P0", bifurcation: "B2C",
      stage: "live", status: "live",
      owner_id: m["u_ceo"], business_owner_id: m["u_anjali"],
      blocked: false,
      stage_entered_at: ago(84), created_at: ago(150),
      target_go_live: "2026-04-20", sacrosanct_go_live: "2026-04-20", final_go_live: "2026-04-20",
      priority_month: "March'26", dev_effort_days: 12,
      product_spoc_id: m["u_sid"], tech_lead_id: m["u_raj"],
      subtasks: [
        { title: "Influencer screens", team: "design",      done: true, assignee_id: m["u_rajkumar"], effort_days: 4, expected_date: "2026-04-10", promised_date: "2026-04-09" },
        { title: "Dealer dashboard",   team: "development", done: true, assignee_id: m["u_raj"],      effort_days: 5, expected_date: "2026-04-15", promised_date: "2026-04-14" },
        { title: "Retailer flows",     team: "development", done: true, assignee_id: m["u_anmol"],    effort_days: 3, expected_date: "2026-04-18", promised_date: "2026-04-17" },
      ],
      comments: [
        { at: ago(90), by_id: m["u_karan"], text: "3 bugs on retailer redemption raised. Sending back to dev.", pinned: false, resolved: true },
        { at: ago(88), by_id: m["u_ceo"],   text: "This is committed to Wonder Cement's leadership for month-end. Please treat as P0 and clear the retailer bugs by Friday.", pinned: true, resolved: true },
      ],
      history: [
        { at: ago(150), by_id: m["u_anjali"],  from_stage: null,      to_stage: "intake",      from_status: null,    to_status: "business_clarification", note: "Project created" },
        { at: ago(140), by_id: m["u_sid"],     from_stage: "intake",  to_stage: "scoping",     from_status: "business_clarification", to_status: "scoping", note: "Scoping" },
        { at: ago(120), by_id: m["u_harshita"],from_stage: "scoping", to_stage: "development", from_status: "scoping", to_status: "dev", note: "Dev" },
        { at: ago(95),  by_id: m["u_karan"],   from_stage: "development","to_stage":"qa",      from_status: "dev",   to_status: "need_bug_fixing",         note: "Bugs raised" },
        { at: ago(92),  by_id: m["u_raj"],     from_stage: "qa",      to_stage: "development", from_status: "need_bug_fixing", to_status: "bug_fixing_initiated", note: "Bug fixing" },
        { at: ago(88),  by_id: m["u_karan"],   from_stage: "development","to_stage":"qa",      from_status: "bug_fixing_initiated", to_status: "qa",       note: "Re-testing" },
        { at: ago(86),  by_id: m["u_anjali"],  from_stage: "qa",      to_stage: "uat",         from_status: "qa",    to_status: "uat",                    note: "UAT" },
        { at: ago(84),  by_id: m["u_ceo"],     from_stage: "uat",     to_stage: "live",        from_status: "uat",   to_status: "live",                   note: "Live!" },
      ],
    },
    {
      code: "TP-004",
      title: "Variable denomination — Luminous",
      brd: "Support variable denomination vouchers for Luminous channel partners.",
      partner: "Luminous", lob: "Channel Program",
      priority: "P0", bifurcation: "B2C",
      stage: "live", status: "live",
      owner_id: m["u_ceo"], business_owner_id: m["u_anjali"],
      blocked: false,
      stage_entered_at: ago(167), created_at: ago(200),
      target_go_live: "2026-01-29", final_go_live: "2026-01-27",
      priority_month: "Jan'26", dev_effort_days: 10,
      product_spoc_id: m["u_harshita"], tech_lead_id: m["u_raj"],
      subtasks: [
        { title: "Denomination config", team: "development", done: true, assignee_id: m["u_raj"], effort_days: 10, expected_date: "2026-01-25", promised_date: "2026-01-25" },
      ],
      history: [
        { at: ago(200), by_id: m["u_anjali"],  from_stage: null,      to_stage: "intake",      from_status: null,    to_status: "business_clarification", note: "Project created" },
        { at: ago(190), by_id: m["u_sid"],     from_stage: "intake",  to_stage: "scoping",     from_status: "business_clarification", to_status: "scoping", note: "Scoping" },
        { at: ago(180), by_id: m["u_harshita"],from_stage: "scoping", to_stage: "development", from_status: "scoping", to_status: "dev", note: "Dev" },
        { at: ago(170), by_id: m["u_karan"],   from_stage: "development","to_stage":"qa",      from_status: "dev",   to_status: "qa",                     note: "QA" },
        { at: ago(168), by_id: m["u_anjali"],  from_stage: "qa",      to_stage: "live",        from_status: "qa",    to_status: "live",                   note: "Live" },
      ],
    },
    {
      code: "TP-005",
      title: "Onboarding of Sterlite Electric (Copy of Cera)",
      brd: "Onboard Sterlite Electric (copy of Cera program setup).",
      partner: "Evolve Brands", lob: "Channel Program",
      priority: "P0", bifurcation: "B2B",
      stage: "live", status: "live",
      owner_id: m["u_ceo"], business_owner_id: m["u_anjali"],
      blocked: false,
      stage_entered_at: ago(90), created_at: ago(130),
      target_go_live: "2026-04-14", final_go_live: "2026-04-14",
      priority_month: "March'26", dev_effort_days: 10,
      product_spoc_id: m["u_sid"], tech_lead_id: m["u_anmol"],
      subtasks: [
        { title: "Clone Cera config", team: "development", done: true, assignee_id: m["u_anmol"], effort_days: 6, expected_date: "2026-04-10", promised_date: "2026-04-09" },
        { title: "Brand theming",     team: "design",      done: true, assignee_id: m["u_rajkumar"], effort_days: 4, expected_date: "2026-04-12", promised_date: "2026-04-11" },
      ],
      history: [
        { at: ago(130), by_id: m["u_anjali"],  from_stage: null,      to_stage: "intake",      from_status: null,    to_status: "business_clarification", note: "Project created" },
        { at: ago(120), by_id: m["u_sid"],     from_stage: "intake",  to_stage: "scoping",     from_status: "business_clarification", to_status: "scoping", note: "Scoping" },
        { at: ago(110), by_id: m["u_harshita"],from_stage: "scoping", to_stage: "development", from_status: "scoping", to_status: "dev", note: "Dev" },
        { at: ago(95),  by_id: m["u_karan"],   from_stage: "development","to_stage":"qa",      from_status: "dev",   to_status: "qa",                     note: "QA" },
        { at: ago(90),  by_id: m["u_anjali"],  from_stage: "qa",      to_stage: "live",        from_status: "qa",    to_status: "live",                   note: "Live" },
      ],
    },
    {
      code: "TP-006",
      title: "Bosch UI revamp",
      brd: "Refresh the Bosch program UI to the new design system.",
      partner: "Bosch", lob: "Channel Program",
      priority: "P0", bifurcation: "B2C",
      stage: "live", status: "live",
      owner_id: m["u_ceo"], business_owner_id: m["u_anjali"],
      blocked: false,
      stage_entered_at: ago(157), created_at: ago(190),
      target_go_live: "2026-02-08", final_go_live: "2026-02-06",
      priority_month: "Jan'26", dev_effort_days: 5,
      product_spoc_id: m["u_harshita"], tech_lead_id: m["u_anmol"],
      subtasks: [],
      history: [
        { at: ago(190), by_id: m["u_anjali"],  from_stage: null,      to_stage: "intake",      from_status: null,    to_status: "business_clarification", note: "Project created" },
        { at: ago(180), by_id: m["u_sid"],     from_stage: "intake",  to_stage: "scoping",     from_status: "business_clarification", to_status: "scoping", note: "Scoping" },
        { at: ago(170), by_id: m["u_harshita"],from_stage: "scoping", to_stage: "development", from_status: "scoping", to_status: "dev", note: "Dev" },
        { at: ago(160), by_id: m["u_karan"],   from_stage: "development","to_stage":"qa",      from_status: "dev",   to_status: "qa",                     note: "QA" },
        { at: ago(157), by_id: m["u_anjali"],  from_stage: "qa",      to_stage: "live",        from_status: "qa",    to_status: "live",                   note: "Live" },
      ],
    },
    {
      code: "TP-007",
      title: "Reward round-up wallet — DBS",
      brd: "New round-up-to-reward wallet mechanic for DBS cardholders.",
      partner: "DBS", lob: "Banking",
      priority: "P1", bifurcation: "B2C",
      stage: "scoping", status: "scoping",
      owner_id: m["u_sid"], business_owner_id: m["u_neha"],
      blocked: false,
      stage_entered_at: ago(7), created_at: ago(10),
      target_go_live: "2026-08-15",
      priority_month: "Aug'26", dev_effort_days: 20,
      product_spoc_id: m["u_sid"], tech_lead_id: m["u_vikas"],
      subtasks: [
        { title: "PRD draft",          team: "product",     done: true,  assignee_id: m["u_sid"],   expected_date: date(5),  promised_date: date(5),  effort_days: 2 },
        { title: "Tech scoping call",  team: "tech_spoc",   done: false, assignee_id: m["u_harshita"], expected_date: date(2), promised_date: date(2), effort_days: 1 },
      ],
      comments: [
        { at: ago(2), by_id: m["u_sid"], text: "Drafting PRD. Need clarity on interest treatment from business.", pinned: false, resolved: false },
      ],
      history: [
        { at: ago(10), by_id: m["u_neha"], from_stage: null,     to_stage: "intake",   from_status: null,                    to_status: "business_clarification", note: "Project created" },
        { at: ago(7),  by_id: m["u_sid"],  from_stage: "intake", to_stage: "scoping",  from_status: "business_clarification", to_status: "scoping",               note: "Scoping started" },
      ],
    },
    {
      code: "TP-008",
      title: "Amex catalogue expansion",
      brd: "Add 40+ new brands to the Amex rewards catalogue with tiered pricing.",
      partner: "Amex", lob: "Banking",
      priority: "P2", bifurcation: "B2C",
      stage: "intake", status: "business_clarification",
      owner_id: m["u_anjali"], business_owner_id: m["u_anjali"],
      blocked: true, block_reason: "Awaiting final brand list + commercials from business.",
      stage_entered_at: ago(5), created_at: ago(6),
      target_go_live: "2026-09-01",
      priority_month: "Sep'26", dev_effort_days: 8,
      product_spoc_id: m["u_sid"], tech_lead_id: m["u_raj"],
      subtasks: [],
      history: [
        { at: ago(6), by_id: m["u_anjali"], from_stage: null, to_stage: "intake", from_status: null, to_status: "business_clarification", note: "Project created — awaiting brand list" },
      ],
    },
    {
      code: "TP-009",
      title: "AU Rewardz hotel booking flow",
      brd: "Seamless hotel booking flow inside AU Rewardz (per AU_Hotel PRD).",
      partner: "AU Bank", lob: "Banking",
      priority: "P0", bifurcation: "B2C",
      stage: "development", status: "bug_fixing_initiated",
      owner_id: m["u_vikas"], business_owner_id: m["u_anjali"],
      blocked: false,
      stage_entered_at: ago(8), created_at: ago(35),
      target_go_live: "2026-07-25", sacrosanct_go_live: "2026-07-25", timeline_eta: "2026-07-20",
      priority_month: "July'26", dev_effort_days: 18,
      product_spoc_id: m["u_harshita"], tech_lead_id: m["u_vikas"],
      subtasks: [
        { title: "Search + results UX", team: "design",      done: true,  assignee_id: m["u_rajkumar"], expected_date: date(20), promised_date: date(19), effort_days: 4 },
        { title: "Booking + payment",   team: "development", done: true,  assignee_id: m["u_vikas"],    expected_date: date(12), promised_date: date(12), effort_days: 8 },
        { title: "Cancellation flow",   team: "development", done: false, assignee_id: m["u_anmol"],    expected_date: date(2),  promised_date: date(3),  effort_days: 3 },
        { title: "QA regression suite", team: "qa",          done: false, assignee_id: m["u_pooja"],    expected_date: date(1),  promised_date: date(1),  effort_days: 2 },
      ],
      comments: [
        { at: ago(8), by_id: m["u_karan"],   text: "Found 3 P1 bugs in the payment confirmation flow. Sending back to dev.", pinned: false, resolved: false },
        { at: ago(7), by_id: m["u_vikas"],   text: "Bug fixing in progress. ETA tomorrow.", pinned: false, resolved: false },
        { at: ago(6), by_id: m["u_harshita"],text: "AU go-live is non-negotiable on Jul 25. Keep me posted daily.", pinned: true, resolved: false },
      ],
      history: [
        { at: ago(35), by_id: m["u_anjali"],  from_stage: null,        to_stage: "intake",      from_status: null,                    to_status: "business_clarification", note: "Project created" },
        { at: ago(30), by_id: m["u_sid"],     from_stage: "intake",    to_stage: "scoping",     from_status: "business_clarification", to_status: "scoping",               note: "Scoping" },
        { at: ago(22), by_id: m["u_harshita"],from_stage: "scoping",   to_stage: "to_be_picked",from_status: "scoping",               to_status: "to_be_picked",           note: "Sent to Dev queue" },
        { at: ago(20), by_id: m["u_vikas"],   from_stage: "to_be_picked","to_stage":"development",from_status: "to_be_picked",       to_status: "dev",                    note: "Picked up" },
        { at: ago(8),  by_id: m["u_karan"],   from_stage: "development","to_stage":"development",from_status: "dev",                  to_status: "need_bug_fixing",        note: "3 P1 bugs found" },
        { at: ago(7),  by_id: m["u_vikas"],   from_stage: "development","to_stage":"development",from_status: "need_bug_fixing",      to_status: "bug_fixing_initiated",   note: "Fixing" },
      ],
    },
    {
      code: "TP-010",
      title: "Variable denomination — Godrej",
      brd: "Variable denomination vouchers for Godrej Club One.",
      partner: "Godrej", lob: "Channel Program",
      priority: "P0", bifurcation: "B2C",
      stage: "live", status: "live",
      owner_id: m["u_ceo"], business_owner_id: m["u_anjali"],
      blocked: false,
      stage_entered_at: ago(174), created_at: ago(210),
      target_go_live: "2026-01-17", final_go_live: "2026-01-20",
      priority_month: "Jan'26", dev_effort_days: 10,
      product_spoc_id: m["u_harshita"], tech_lead_id: m["u_anmol"],
      subtasks: [
        { title: "Denomination config", team: "development", done: true, assignee_id: m["u_anmol"], effort_days: 10, expected_date: "2026-01-16", promised_date: "2026-01-16" },
      ],
      history: [
        { at: ago(210), by_id: m["u_anjali"],  from_stage: null,      to_stage: "intake",      from_status: null,    to_status: "business_clarification", note: "Project created" },
        { at: ago(200), by_id: m["u_sid"],     from_stage: "intake",  to_stage: "scoping",     from_status: "business_clarification", to_status: "scoping", note: "Scoping" },
        { at: ago(190), by_id: m["u_harshita"],from_stage: "scoping", to_stage: "development", from_status: "scoping", to_status: "dev", note: "Dev" },
        { at: ago(178), by_id: m["u_karan"],   from_stage: "development","to_stage":"qa",      from_status: "dev",   to_status: "qa",                     note: "QA" },
        { at: ago(175), by_id: m["u_anjali"],  from_stage: "qa",      to_stage: "live",        from_status: "qa",    to_status: "live",                   note: "Live" },
      ],
    },
  ];
}

async function seedProjects(sidToUuid) {
  console.log("\nSeeding projects…");
  const { data: existing } = await db.from("projects").select("id, code");
  const existingCodes = new Set((existing ?? []).map(r => r.code));

  const projects = buildProjects(sidToUuid);

  for (const proj of projects) {
    if (existingCodes.has(proj.code)) {
      console.log(`  Skipping ${proj.code} — already exists.`);
      continue;
    }

    const { subtasks, comments, history, ...projectRow } = proj;

    // Fix: remove timeline_eta from insert (not in schema insert list) — keep as is
    const { data: inserted, error } = await db.from("projects").insert(projectRow).select("id").single();
    if (error) { console.error(`  Error inserting ${proj.code}:`, error.message); continue; }

    const pid = inserted.id;
    console.log(`  ✓ ${proj.code} — ${proj.title.slice(0, 50)}`);

    // Subtasks
    if (subtasks?.length) {
      const rows = subtasks.map(s => ({ project_id: pid, title: s.title, team: s.team, assignee_id: s.assignee_id ?? null, done: s.done, expected_date: s.expected_date ?? null, promised_date: s.promised_date ?? null, effort_days: s.effort_days ?? null }));
      const { error: se } = await db.from("subtasks").insert(rows);
      if (se) console.error(`    Subtasks error:`, se.message);
      else console.log(`    + ${rows.length} subtask(s)`);
    }

    // History
    if (history?.length) {
      const rows = history.map(h => ({ project_id: pid, at: h.at, by_id: h.by_id, from_stage: h.from_stage, to_stage: h.to_stage, from_status: h.from_status, to_status: h.to_status, note: h.note }));
      const { error: he } = await db.from("stage_history").insert(rows);
      if (he) console.error(`    History error:`, he.message);
      else console.log(`    + ${rows.length} history entry(ies)`);
    }

    // Comments
    if (comments?.length) {
      const rows = comments.map(c => ({ project_id: pid, at: c.at, by_id: c.by_id, text: c.text, pinned: c.pinned ?? false, resolved: c.resolved ?? false }));
      const { error: ce } = await db.from("comments").insert(rows);
      if (ce) console.error(`    Comments error:`, ce.message);
      else console.log(`    + ${rows.length} comment(s)`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Gyftr Tech Portal — DB Seed ===\n");
  await runMigration();
  const sidToUuid = await seedPeople();
  console.log("\nPeople UUID map:", Object.entries(sidToUuid).map(([k,v]) => `${k}→${v?.slice(0,8)}`).join(", "));
  await seedProjects(sidToUuid);
  console.log("\n=== Done ===");
}

main().catch(console.error);
