/**
 * Update existing subtasks with assignee, expected_date, promised_date, effort_days.
 * Also backfills any missing history/comments.
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

async function main() {
  // Load people UUID map
  const { data: people } = await db.from("people").select("id, email");
  const m = {};
  const emailMap = {
    "neha@gyftr.net": "u_neha", "anjali.gupta@gyftr.net": "u_anjali",
    "priya.sharma@gyftr.net": "u_biz1", "rahul.joshi@gyftr.net": "u_biz2",
    "saurabh@gyftr.net": "u_saurabh", "siddharth@gyftr.net": "u_sid",
    "yash.tahlyani@gyftr.net": "u_yash", "rajneesh@gyftr.net": "u_rajneesh",
    "harshita@gyftr.net": "u_harshita", "deepak@gyftr.net": "u_mgr2",
    "sameer@gyftr.net": "u_mgr3", "pankaj@gyftr.net": "u_mgr4",
    "raj@gyftr.net": "u_raj", "anmol@gyftr.net": "u_anmol",
    "vikas@gyftr.net": "u_vikas", "rajkumar@gyftr.net": "u_rajkumar",
    "pooja@gyftr.net": "u_pooja", "karan@gyftr.net": "u_karan",
    "pmo@gyftr.net": "u_pmo", "leadership@gyftr.net": "u_ceo",
  };
  for (const p of people) {
    const sid = emailMap[p.email];
    if (sid) m[sid] = p.id;
  }
  console.log("People loaded:", Object.keys(m).length);

  // Load projects by code
  const { data: projs } = await db.from("projects").select("id, code");
  const pc = {};
  for (const p of projs) pc[p.code] = p.id;
  console.log("Projects loaded:", Object.keys(pc).length);

  // Load all subtasks
  const { data: subtasks } = await db.from("subtasks").select("id, project_id, title");
  console.log("Subtasks loaded:", subtasks.length);

  // Match subtask by project_id + title → apply update
  const updates = [
    // TP-001
    { pid: pc["TP-001"], title: "Bill payment integration",        assignee_id: m["u_raj"],       expected_date: date(20), promised_date: date(18), effort_days: 5 },
    { pid: pc["TP-001"], title: "Flights (Cleartrip) integration", assignee_id: m["u_anmol"],     expected_date: date(5),  promised_date: date(4),  effort_days: 8 },
    { pid: pc["TP-001"], title: "Hotels flow + UI",                assignee_id: m["u_rajkumar"],  expected_date: date(25), promised_date: date(24), effort_days: 3 },
    { pid: pc["TP-001"], title: "Round-up wallet logic",           assignee_id: m["u_vikas"],     expected_date: date(3),  promised_date: date(3),  effort_days: 4 },
    // TP-002
    { pid: pc["TP-002"], title: "Payment element",                 assignee_id: m["u_vikas"],     expected_date: "2026-01-14", promised_date: "2026-01-14", effort_days: 15 },
    // TP-003
    { pid: pc["TP-003"], title: "Influencer screens",              assignee_id: m["u_rajkumar"],  expected_date: "2026-04-10", promised_date: "2026-04-09", effort_days: 4 },
    { pid: pc["TP-003"], title: "Dealer dashboard",                assignee_id: m["u_raj"],       expected_date: "2026-04-15", promised_date: "2026-04-14", effort_days: 5 },
    { pid: pc["TP-003"], title: "Retailer flows",                  assignee_id: m["u_anmol"],     expected_date: "2026-04-18", promised_date: "2026-04-17", effort_days: 3 },
    // TP-004
    { pid: pc["TP-004"], title: "Denomination config",             assignee_id: m["u_raj"],       expected_date: "2026-01-25", promised_date: "2026-01-25", effort_days: 10 },
    // TP-005
    { pid: pc["TP-005"], title: "Clone Cera config",               assignee_id: m["u_anmol"],     expected_date: "2026-04-10", promised_date: "2026-04-09", effort_days: 6 },
    { pid: pc["TP-005"], title: "Brand theming",                   assignee_id: m["u_rajkumar"],  expected_date: "2026-04-12", promised_date: "2026-04-11", effort_days: 4 },
    // TP-007
    { pid: pc["TP-007"], title: "PRD draft",                       assignee_id: m["u_sid"],       expected_date: date(5),  promised_date: date(5),  effort_days: 2 },
    { pid: pc["TP-007"], title: "Tech scoping call",               assignee_id: m["u_harshita"],  expected_date: date(2),  promised_date: date(2),  effort_days: 1 },
    // TP-009
    { pid: pc["TP-009"], title: "Search + results UX",             assignee_id: m["u_rajkumar"],  expected_date: date(20), promised_date: date(19), effort_days: 4 },
    { pid: pc["TP-009"], title: "Booking + payment",               assignee_id: m["u_vikas"],     expected_date: date(12), promised_date: date(12), effort_days: 8 },
    { pid: pc["TP-009"], title: "Cancellation flow",               assignee_id: m["u_anmol"],     expected_date: date(2),  promised_date: date(3),  effort_days: 3 },
    // TP-010
    { pid: pc["TP-010"], title: "Denomination config",             assignee_id: m["u_anmol"],     expected_date: "2026-01-16", promised_date: "2026-01-16", effort_days: 10 },
  ];

  // Add missing subtasks for TP-007 and TP-009 if they don't have them
  const existingTitles = new Set(subtasks.map(s => `${s.project_id}::${s.title}`));
  const toInsert = [
    { project_id: pc["TP-007"], title: "PRD draft",         team: "product",   done: true,  assignee_id: m["u_sid"],      expected_date: date(5),  promised_date: date(5),  effort_days: 2 },
    { project_id: pc["TP-007"], title: "Tech scoping call", team: "tech_spoc", done: false, assignee_id: m["u_harshita"], expected_date: date(2),  promised_date: date(2),  effort_days: 1 },
    { project_id: pc["TP-009"], title: "QA regression suite",team: "qa",       done: false, assignee_id: m["u_pooja"],    expected_date: date(1),  promised_date: date(1),  effort_days: 2 },
  ].filter(s => !existingTitles.has(`${s.project_id}::${s.title}`));

  if (toInsert.length) {
    const { error } = await db.from("subtasks").insert(toInsert);
    if (error) console.error("Insert new subtasks error:", error.message);
    else console.log(`\nInserted ${toInsert.length} new subtask(s).`);
  }

  // Apply updates
  console.log("\nUpdating subtasks…");
  let updated = 0;
  for (const upd of updates) {
    const match = subtasks.find(s => s.project_id === upd.pid && s.title === upd.title);
    if (!match) { console.log(`  Not found: ${upd.title} in ${Object.keys(pc).find(k => pc[k] === upd.pid)}`); continue; }
    const { error } = await db.from("subtasks").update({
      assignee_id: upd.assignee_id,
      expected_date: upd.expected_date,
      promised_date: upd.promised_date,
      effort_days: upd.effort_days,
    }).eq("id", match.id);
    if (error) console.error(`  Error updating "${upd.title}":`, error.message);
    else { console.log(`  ✓ ${upd.title}`); updated++; }
  }

  // Backfill missing history for projects that have none
  console.log("\nChecking history…");
  const { data: hist } = await db.from("stage_history").select("project_id");
  const hasHistory = new Set(hist.map(h => h.project_id));

  const historyData = {
    [pc["TP-001"]]: [
      { at: ago(48), by_id: m["u_anjali"],   from_stage: null,           to_stage: "intake",       from_status: null,                     to_status: "business_clarification", note: "Project created" },
      { at: ago(40), by_id: m["u_sid"],      from_stage: "intake",       to_stage: "scoping",      from_status: "business_clarification",  to_status: "scoping",                note: "Scoping started" },
      { at: ago(30), by_id: m["u_harshita"], from_stage: "scoping",      to_stage: "to_be_picked", from_status: "scoping",                 to_status: "to_be_picked",           note: "Sent to Dev" },
      { at: ago(20), by_id: m["u_raj"],      from_stage: "to_be_picked", to_stage: "development",  from_status: "to_be_picked",            to_status: "dev",                    note: "Picked up" },
      { at: ago(9),  by_id: m["u_karan"],    from_stage: "development",  to_stage: "uat",          from_status: "dev",                     to_status: "qa_clarification_pending",note: "Cleartrip staging issue" },
    ],
    [pc["TP-007"]]: [
      { at: ago(10), by_id: m["u_neha"],  from_stage: null,     to_stage: "intake",   from_status: null,                    to_status: "business_clarification", note: "Project created" },
      { at: ago(7),  by_id: m["u_sid"],   from_stage: "intake", to_stage: "scoping",  from_status: "business_clarification", to_status: "scoping",               note: "Scoping started" },
    ],
    [pc["TP-008"]]: [
      { at: ago(6), by_id: m["u_anjali"], from_stage: null, to_stage: "intake", from_status: null, to_status: "business_clarification", note: "Project created — awaiting brand list" },
    ],
    [pc["TP-009"]]: [
      { at: ago(35), by_id: m["u_anjali"],  from_stage: null,           to_stage: "intake",       from_status: null,                     to_status: "business_clarification", note: "Project created" },
      { at: ago(30), by_id: m["u_sid"],     from_stage: "intake",       to_stage: "scoping",      from_status: "business_clarification",  to_status: "scoping",               note: "Scoping" },
      { at: ago(22), by_id: m["u_harshita"],from_stage: "scoping",      to_stage: "to_be_picked", from_status: "scoping",                 to_status: "to_be_picked",          note: "Sent to Dev queue" },
      { at: ago(20), by_id: m["u_vikas"],   from_stage: "to_be_picked", to_stage: "development",  from_status: "to_be_picked",            to_status: "dev",                   note: "Picked up" },
      { at: ago(8),  by_id: m["u_karan"],   from_stage: "development",  to_stage: "development",  from_status: "dev",                     to_status: "need_bug_fixing",       note: "3 P1 bugs found" },
      { at: ago(7),  by_id: m["u_vikas"],   from_stage: "development",  to_stage: "development",  from_status: "need_bug_fixing",          to_status: "bug_fixing_initiated",  note: "Fixing" },
    ],
  };

  for (const [pid, rows] of Object.entries(historyData)) {
    if (hasHistory.has(pid)) { console.log(`  History already exists for ${Object.keys(pc).find(k => pc[k] === pid)}`); continue; }
    const toInsert = rows.map(h => ({ project_id: pid, ...h }));
    const { error } = await db.from("stage_history").insert(toInsert);
    if (error) console.error(`  History error for ${pid}:`, error.message);
    else console.log(`  ✓ ${toInsert.length} history rows for ${Object.keys(pc).find(k => pc[k] === pid)}`);
  }

  // Backfill missing comments
  console.log("\nChecking comments…");
  const { data: existingComments } = await db.from("comments").select("project_id");
  const hasComments = new Set(existingComments.map(c => c.project_id));

  const commentData = {
    [pc["TP-001"]]: [
      { at: ago(3), by_id: m["u_pooja"],   text: "Cleartrip staging keeps timing out on Bills API. Blocked on partner infra.", pinned: false, resolved: false },
      { at: ago(1), by_id: m["u_anjali"],  text: "Escalated to Godrej. Awaiting stable staging endpoint.", pinned: false, resolved: false },
    ],
    [pc["TP-007"]]: [
      { at: ago(2), by_id: m["u_sid"], text: "Drafting PRD. Need clarity on interest treatment from business.", pinned: false, resolved: false },
    ],
    [pc["TP-009"]]: [
      { at: ago(8), by_id: m["u_karan"],    text: "Found 3 P1 bugs in the payment confirmation flow. Sending back to dev.", pinned: false, resolved: false },
      { at: ago(7), by_id: m["u_vikas"],    text: "Bug fixing in progress. ETA tomorrow.", pinned: false, resolved: false },
      { at: ago(6), by_id: m["u_harshita"], text: "AU go-live is non-negotiable on Jul 25. Keep me posted daily.", pinned: true, resolved: false },
    ],
    [pc["TP-003"]]: [
      { at: ago(90), by_id: m["u_karan"], text: "3 bugs on retailer redemption raised. Sending back to dev.", pinned: false, resolved: true },
      { at: ago(88), by_id: m["u_ceo"],   text: "This is committed to Wonder Cement's leadership for month-end. Please treat as P0 and clear the retailer bugs by Friday.", pinned: true, resolved: true },
    ],
  };

  for (const [pid, rows] of Object.entries(commentData)) {
    if (hasComments.has(pid)) { console.log(`  Comments already exist for ${Object.keys(pc).find(k => pc[k] === pid)}`); continue; }
    const toInsert = rows.map(c => ({ project_id: pid, ...c }));
    const { error } = await db.from("comments").insert(toInsert);
    if (error) console.error(`  Comments error:`, error.message);
    else console.log(`  ✓ ${toInsert.length} comment(s) for ${Object.keys(pc).find(k => pc[k] === pid)}`);
  }

  console.log(`\n=== Done — ${updated} subtasks updated ===`);
}

main().catch(console.error);
