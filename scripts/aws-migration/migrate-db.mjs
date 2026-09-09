// migrate-db.mjs — ONE-TIME copy of the live Supabase Postgres database into
// RDS, run once by whoever provisions RDS and has real credentials for both
// databases.
//
// ── This script has NOT been run or tested against a live database ─────────
// There are no AWS or Supabase credentials available in the environment this
// was written in (see README/HANDOVER — this migration's scope is code +
// infra runbook only, nothing is provisioned or cut over from here). It has
// been written carefully against backend/sql/01_schema.sql and reviewed for
// FK ordering, but it must be dry-run (see --dry-run below) against a real
// staging copy before anyone trusts it against production data.
//
//   cd scripts && npm install
//   SUPABASE_DB_URL="postgres://...supabase.co:5432/postgres" node aws-migration/migrate-db.mjs --dry-run
//   SUPABASE_DB_URL="postgres://...supabase.co:5432/postgres" node aws-migration/migrate-db.mjs
//
// SUPABASE_DB_URL: the live Supabase project's Postgres connection string
//   (Settings → Database → Connection string → URI). Use the direct
//   connection, not the pgbouncer/pooled one — this does a small number of
//   large sequential SELECTs, not many short-lived ones.
// RDS side comes from ../.env via rdsClient.mjs (DB_HOST/DB_NAME/DB_USER/DB_PASSWORD).
//
// ── What it does ─────────────────────────────────────────────────────────────
// Copies every row from the seven supabase/schema.sql tables into the
// matching backend/sql/01_schema.sql tables, IN FK-SAFE ORDER, preserving
// primary keys (so cross-references stay valid) and using
// `ON CONFLICT (id) DO NOTHING` (safe to re-run — a partial failure halfway
// through can simply be re-run from the top rather than needing a rollback).
//
// Column mapping notes (see backend/sql/01_schema.sql's header for the full
// RLS -> authz.js port context):
//   people.auth_id      -> NOT copied. cognito_sub starts NULL for every
//                          migrated person and is filled in either by
//                          create-cognito-users.mjs (below) or by
//                          middleware/identity.js's auto-link on first login.
//   attachments.storage_key -> NOT in the source schema (every Supabase-era
//                          attachment was a caller-supplied `url`, never an
//                          upload — see backend/s3.js's header). Left NULL;
//                          new uploads after cutover populate it.
//
// Order matters: people first (self-referencing via manager_id — see the
// two-pass note below), then projects (references people), then everything
// that references projects.
import { rds } from './rdsClient.mjs';
import pg from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');
const SUPABASE_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_URL) {
  console.error('Set SUPABASE_DB_URL to the live Supabase project\'s direct Postgres connection string.');
  process.exit(1);
}

const supabase = new pg.Pool({ connectionString: SUPABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });

// Each entry: [table, columns in insertion order]. Columns must exist on
// BOTH sides — see the mapping notes above for the two that don't carry over.
const TABLES = [
  {
    table: 'people',
    columns: ['id', 'name', 'email', 'team', 'role', 'manager_id', 'department', 'sees_all_projects', 'active'],
    // manager_id is self-referencing. A single-pass insert in arbitrary row
    // order can hit a row whose manager hasn't been inserted yet even though
    // the manager IS in this same table — so people are inserted WITHOUT
    // manager_id first, then manager_id is backfilled in a second pass. This
    // makes row order within `people` irrelevant, which a plain FK-ordered
    // copy (correct for every other table here) does not guarantee on its own.
    twoPassSelfRef: 'manager_id',
  },
  {
    table: 'projects',
    columns: [
      'id', 'code', 'title', 'brd', 'partner', 'brand', 'lob', 'priority', 'bifurcation',
      'stage', 'status', 'owner_id', 'business_owner_id', 'blocked', 'block_reason',
      'on_hold', 'hold_reason', 'held_by_id', 'held_by_team', 'held_at',
      'owner_team', 'involved_teams', 'stage_entered_at', 'created_at',
      'target_go_live', 'sacrosanct_go_live', 'priority_month', 'timeline_eta',
      'dev_effort_days', 'reason_for_delay', 'product_spoc_id', 'tech_lead_id', 'final_go_live',
    ],
  },
  {
    table: 'subtasks',
    columns: ['id', 'project_id', 'title', 'team', 'assignee_id', 'done', 'created_at', 'expected_date', 'promised_date', 'effort_days'],
  },
  {
    table: 'stage_targets',
    columns: ['id', 'project_id', 'stage', 'expected_date', 'updated_by', 'updated_at'],
  },
  {
    table: 'stage_history',
    columns: ['id', 'project_id', 'at', 'by_id', 'from_stage', 'to_stage', 'from_status', 'to_status', 'note'],
  },
  {
    table: 'comments',
    columns: ['id', 'project_id', 'at', 'by_id', 'text', 'pinned', 'resolved'],
  },
  {
    table: 'attachments',
    // storage_key deliberately omitted — see header note.
    columns: ['id', 'project_id', 'name', 'kind', 'url', 'by_id', 'at'],
  },
];

async function copyTable({ table, columns, twoPassSelfRef }) {
  const selectCols = twoPassSelfRef ? columns.filter((c) => c !== twoPassSelfRef) : columns;
  const { rows } = await supabase.query(`select ${selectCols.join(', ')} from ${table}`);
  console.log(`  ${table}: ${rows.length} row(s) in Supabase`);

  if (DRY_RUN) return { table, count: rows.length };
  if (rows.length === 0) return { table, count: 0 };

  const placeholders = selectCols.map((_, i) => `$${i + 1}`).join(', ');
  const insertSql = `insert into ${table} (${selectCols.join(', ')}) values (${placeholders}) on conflict (id) do nothing`;

  let inserted = 0;
  for (const row of rows) {
    const values = selectCols.map((c) => row[c]);
    const res = await rds.query(insertSql, values);
    inserted += res.rowCount;
  }
  console.log(`  ${table}: ${inserted} row(s) inserted into RDS (${rows.length - inserted} already present, skipped)`);

  if (twoPassSelfRef) {
    console.log(`  ${table}: backfilling ${twoPassSelfRef}…`);
    let linked = 0;
    for (const row of rows) {
      if (row[twoPassSelfRef] == null) continue;
      await rds.query(`update ${table} set ${twoPassSelfRef} = $1 where id = $2`, [row[twoPassSelfRef], row.id]);
      linked++;
    }
    console.log(`  ${table}: ${linked} ${twoPassSelfRef} reference(s) backfilled`);
  }

  return { table, count: inserted };
}

async function main() {
  console.log(`\n=== migrate-db — Supabase -> RDS ===`);
  console.log(DRY_RUN ? 'Mode: DRY RUN — counts only, nothing written to RDS\n' : 'Mode: LIVE\n');

  const results = [];
  for (const spec of TABLES) {
    results.push(await copyTable(spec));
  }

  console.log('\n── Summary ──');
  for (const r of results) console.log(`  ${r.table.padEnd(16)} ${r.count}`);

  if (!DRY_RUN) {
    console.log('\nNext steps:');
    console.log('  1. node aws-migration/create-cognito-users.mjs   — create Cognito accounts for migrated people');
    console.log('  2. cd .. && cd scripts && node doctor.mjs         — verify the RDS side looks healthy');
  }
}

main()
  .then(async () => { await supabase.end(); await rds.end(); process.exit(0); })
  .catch(async (err) => {
    console.error('migrate-db failed:', err.message);
    await supabase.end().catch(() => {});
    await rds.end().catch(() => {});
    process.exit(1);
  });
