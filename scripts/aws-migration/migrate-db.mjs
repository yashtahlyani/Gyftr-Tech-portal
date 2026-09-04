#!/usr/bin/env node
/* ─── Exports every table from the live Supabase project (service-role key,
   bypasses RLS) and inserts it into RDS. Explicit column lists per table
   (not `select *` / `insert ... select *`) since a couple of columns differ
   between the two schemas — Supabase's `people.auth_id` has no RDS
   equivalent yet (that's `cognito_sub`, filled in by create-cognito-users.mjs
   after this script runs). IDs are carried over as-is so every foreign key
   (project.owner_id, subtask.assignee_id, etc.) still resolves correctly.

   Uses ON CONFLICT DO NOTHING everywhere, so re-running after a partial
   failure is always safe — nothing gets double-inserted or overwritten. ─── */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { connectRds } from "./rdsClient.mjs";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(", ")}. Copy .env.example to .env and fill them in.`);
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchAll(table, select = "*") {
  const { data, error } = await supabase.from(table).select(select);
  if (error) throw new Error(`Failed to read ${table} from Supabase: ${error.message}`);
  return data ?? [];
}

async function insertRows(client, table, columns, rows) {
  let inserted = 0;
  for (const row of rows) {
    const values = columns.map((c) => row[c] ?? null);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(",");
    const { rowCount } = await client.query(
      `insert into ${table} (${columns.join(",")}) values (${placeholders}) on conflict (id) do nothing`,
      values
    );
    inserted += rowCount;
  }
  console.log(`  ${table}: ${inserted}/${rows.length} inserted (rest already present)`);
}

async function main() {
  const client = await connectRds();
  try {
    console.log("Migrating people…");
    const people = await fetchAll("people", "id,name,email,team,role");
    await insertRows(client, "people", ["id", "name", "email", "team", "role"], people);

    console.log("Migrating projects…");
    const projects = await fetchAll("projects");
    await insertRows(client, "projects", [
      "id", "code", "title", "brd", "partner", "brand", "lob", "priority", "bifurcation",
      "stage", "status", "owner_id", "business_owner_id", "blocked", "block_reason",
      "owner_team", "involved_teams", "stage_entered_at", "created_at",
      "target_go_live", "sacrosanct_go_live", "priority_month", "timeline_eta",
      "dev_effort_days", "reason_for_delay", "product_spoc_id", "tech_lead_id", "final_go_live",
    ], projects);

    console.log("Migrating subtasks…");
    const subtasks = await fetchAll("subtasks");
    await insertRows(client, "subtasks", [
      "id", "project_id", "title", "team", "assignee_id", "done", "created_at",
      "expected_date", "promised_date", "effort_days",
    ], subtasks);

    console.log("Migrating stage_targets…");
    const stageTargets = await fetchAll("stage_targets");
    await insertRows(client, "stage_targets", [
      "id", "project_id", "stage", "expected_date", "updated_by", "updated_at",
    ], stageTargets);

    console.log("Migrating stage_history…");
    const stageHistory = await fetchAll("stage_history");
    await insertRows(client, "stage_history", [
      "id", "project_id", "at", "by_id", "from_stage", "to_stage", "from_status", "to_status", "note",
    ], stageHistory);

    console.log("Migrating comments…");
    const comments = await fetchAll("comments");
    await insertRows(client, "comments", ["id", "project_id", "at", "by_id", "text", "pinned", "resolved"], comments);

    console.log("Migrating attachments…");
    const attachments = await fetchAll("attachments");
    await insertRows(client, "attachments", ["id", "project_id", "name", "kind", "url", "by_id", "at"], attachments);

    console.log("\nDone. Next: run create-cognito-users.mjs to create logins and link them to these people rows.");
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
