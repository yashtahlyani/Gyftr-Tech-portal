/**
 * doctor.mjs — check everything the Tech Portal needs, and report it ALL at once.
 *
 * Mirrors scripts/doctor.mjs in the CEO Office / Marketing / Legal portals,
 * adapted for this app's authorization model: there is no Postgres RLS here
 * (see DATABASE.md), so this does NOT check pgcrypto/authenticated-role/
 * SET-ROLE/policy-count the way the CEO Office version does — none of that
 * exists in this schema (see backend/sql/01_schema.sql's header and
 * infra/dba-setup.sql's comment on why this app's DBA step is simpler).
 * Instead it checks plain table existence, since backend/db.js applies
 * backend/sql/*.sql idempotently on every boot and a genuinely broken
 * database usually means "the app never got to apply its migrations",
 * not "RLS is misconfigured".
 *
 *   cd scripts && node doctor.mjs
 *
 * The problem this solves: the backend applies its migrations on boot and
 * stops at the FIRST failure, so a misconfigured database is discovered one
 * error per deploy — fix, redeploy, wait, hit the next one. This runs every
 * check independently and prints one complete list, so the whole thing can
 * be fixed in a single pass.
 *
 * Exit code is 0 only if nothing is broken, so it is safe in a pipeline.
 */

import { db, USER_POOL_ID, hasCognito, cognito } from './lib.mjs';
import { ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';

const PASS = '  \x1b[32m✓\x1b[0m';
const FAIL = '  \x1b[31m✗\x1b[0m';
const WARN = '  \x1b[33m!\x1b[0m';

const problems = [];
const warnings = [];

function ok(msg)        { console.log(`${PASS} ${msg}`); }
function bad(msg, fix)  { console.log(`${FAIL} ${msg}`); problems.push({ msg, fix }); }
function warn(msg, fix) { console.log(`${WARN} ${msg}`); warnings.push({ msg, fix }); }

// Every table backend/sql/01_schema.sql creates.
const TABLES = ['people', 'projects', 'subtasks', 'stage_targets', 'stage_history', 'comments', 'attachments'];

async function q(sql, params) {
  const { rows } = await db.query(sql, params);
  return rows;
}

// Each check is wrapped so one failure never hides the rest — that is the
// whole point of this script.
async function check(label, fn) {
  try { await fn(); }
  catch (err) { bad(`${label} — ${err.message}`, null); }
}

async function main() {
  console.log('\n=== Gyftr Tech Portal — doctor ===\n');

  // ── Connection ────────────────────────────────────────────────────────────
  let me;
  try {
    [{ current_user: me }] = await q('select current_user');
    const [{ v }] = await q('select version() as v');
    ok(`connected as "${me}"`);
    ok(v.split(',')[0]);
  } catch (err) {
    bad(`cannot connect to the database — ${err.message}`,
        'Check DB_HOST/DB_NAME/DB_USER/DB_PASSWORD in ../.env, and the RDS security group.');
    return report();
  }

  console.log('\n── Prerequisites (infra/dba-setup.sql) ──');
  console.log('  This app has no RLS, no `authenticated` role, and no pgcrypto');
  console.log('  requirement (gen_random_uuid() is core in PG13+) — see');
  console.log('  infra/dba-setup.sql\'s header for why its checklist is short.');

  await check('database owner / CREATE privilege', async () => {
    const r = await q(
      `select has_database_privilege($1, current_database(), 'CREATE') as can_create`, [me]
    );
    r[0]?.can_create
      ? ok(`"${me}" can create objects in this database`)
      : bad(`"${me}" cannot create objects in this database`,
            'Run infra/dba-setup.sql as the RDS master, or grant CREATE manually.');
  });

  console.log('\n── Schema (applied by the backend on boot) ──');

  for (const t of TABLES) {
    await check(t, async () => {
      const r = await q(
        `select pg_get_userbyid(c.relowner) as owner
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1`, [t]
      );
      if (!r.length) {
        return bad(`table "${t}" is missing`,
                   'The backend has not applied backend/sql/01_schema.sql yet — check its logs (it applies migrations on boot, retrying).');
      }
      const { owner } = r[0];
      ok(`"${t}" exists${owner === me ? '' : `  (owner: ${owner})`}`);
    });
  }

  console.log('\n── Data ──');

  await check('people', async () => {
    const rows = await q(`select team, count(*)::int as n from people where active group by team order by team`);
    if (!rows.length) {
      return warn('no active people — nobody can sign in',
                  'Run:  node seed.mjs   (demo)  or  node onboard.mjs --apply  (real roster)');
    }
    ok(`people: ${rows.map((r) => `${r.n} ${r.team}`).join(', ')}`);
    const [{ n: unlinked }] = await q(
      'select count(*)::int as n from people where cognito_sub is null and active');
    if (unlinked > 0) {
      warn(`${unlinked} active person/people have no Cognito link yet`,
           'Normal before first sign-in — they link automatically on first login (middleware/identity.js).');
    }
    const [{ n: pmoCount }] = await q("select count(*)::int as n from people where role = 'pmo' and active");
    if (pmoCount === 0) {
      warn('no active PMO — nobody has the overseer/full-edit role', null);
    }
  });

  await check('projects', async () => {
    const [{ n }] = await q('select count(*)::int as n from projects');
    ok(`${n} project(s)`);
  });

  // ── Cognito ───────────────────────────────────────────────────────────────
  console.log('\n── Cognito ──');
  if (!hasCognito) {
    bad('COGNITO_USER_POOL_ID is not set', 'Set it in ../.env (and on the ECS task).');
  } else {
    await check('pool', async () => {
      const res = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60 }));
      const n = (res.Users || []).length;
      ok(`pool ${USER_POOL_ID} reachable — ${n}${res.PaginationToken ? '+' : ''} account(s)`);

      const emails = new Set((res.Users || []).map((u) =>
        (u.Attributes?.find((a) => a.Name === 'email')?.Value || u.Username || '').toLowerCase()));
      const persons = await q('select lower(email) as email from people where active');
      const noAccount = persons.filter((p) => !emails.has(p.email));
      if (noAccount.length && !res.PaginationToken) {
        warn(`${noAccount.length} active person/people have no Cognito account`,
             'They cannot sign in. Run node onboard.mjs --apply, or create-person.mjs.');
      }
    });
  }

  report();
}

function report() {
  console.log('');
  if (!problems.length && !warnings.length) {
    console.log('\x1b[32mEverything checks out.\x1b[0m\n');
    return 0;
  }
  if (problems.length) {
    console.log(`\x1b[31m${problems.length} problem(s) to fix:\x1b[0m`);
    problems.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.msg}`);
      if (p.fix) console.log(`     → ${p.fix}`);
    });
    console.log('');
  }
  if (warnings.length) {
    console.log(`\x1b[33m${warnings.length} warning(s):\x1b[0m`);
    warnings.forEach((w, i) => {
      console.log(`  ${i + 1}. ${w.msg}`);
      if (w.fix) console.log(`     → ${w.fix}`);
    });
    console.log('');
  }
  return problems.length ? 1 : 0;
}

main()
  .then(async () => {
    const code = problems.length ? 1 : 0;
    await db.end();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error('\ndoctor failed:', err.message);
    await db.end().catch(() => {});
    process.exit(1);
  });
