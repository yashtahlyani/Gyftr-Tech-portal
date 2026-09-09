// Onboard the REAL org from scripts/roster.json.
//
//   cd scripts && node onboard.mjs           # dry run — shows what would happen
//   cd scripts && node onboard.mjs --apply   # actually create the accounts
//
// This is NOT the demo seed (see seed.mjs). Differences that matter:
//
//   · It never touches projects. It only creates or updates people, so it is
//     safe to run against a database that already holds real work.
//   · Every person gets their OWN random password, never a shared one.
//   · It tries an email invite first and falls back to a printed password
//     only when mail cannot be sent — and says which happened, per person.
//   · managerId is resolved from an optional `managerEmail` in a SECOND pass,
//     after every row has been created — manager_id is self-referencing
//     (people.manager_id -> people.id), so a manager listed later in the file
//     (or even circularly) still resolves correctly.
//
// The roster lives in scripts/roster.json, which is gitignored: this
// repository is public, and a real directory of names and working addresses
// is what gets scraped for phishing. See roster.example.json.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { db, cognito, USER_POOL_ID, hasCognito, TEAMS, ROLES } from './lib.mjs';
import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const here = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
// --shared-password uses DEMO_PASSWORD for everyone instead of a unique
// random one each. NOT the default, and not what you want once this holds
// real work: one password across the whole company means one leak exposes
// every account. It exists because evaluation is easier when everyone can
// just get in.
const SHARED = process.argv.includes('--shared-password');
const ROSTER = join(here, 'roster.json');

if (!existsSync(ROSTER)) {
  console.error('No scripts/roster.json found.');
  console.error('Copy scripts/roster.example.json to scripts/roster.json and fill it in.');
  console.error('Do NOT commit it — this repository is public.');
  process.exit(1);
}

const { people } = JSON.parse(readFileSync(ROSTER, 'utf8'));
if (!Array.isArray(people) || people.length === 0) {
  console.error('roster.json has no "people" array.');
  process.exit(1);
}

// Strong, unique, and satisfying Cognito's default password policy (upper,
// lower, digit, symbol, 8+). Only ever needed when the invite email cannot
// be sent.
function tempPassword() {
  const pick = (s) => s[randomBytes(1)[0] % s.length];
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*'];
  const all = sets.join('');
  const out = sets.map(pick);
  while (out.length < 16) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

// ── Validate before touching anything ────────────────────────────────────────
const problems = [];
const byEmail = new Map();
for (const [i, p] of people.entries()) {
  const row = `row ${i + 1} (${p.name || 'unnamed'})`;
  if (!p.name?.trim()) problems.push(`${row}: missing name`);
  if (!p.email?.trim()) problems.push(`${row}: missing email`);
  if (!TEAMS.includes(p.team)) {
    problems.push(`${row}: team must be one of ${TEAMS.join(', ')}, got ${JSON.stringify(p.team)}`);
  }
  if (p.role !== undefined && !ROLES.includes(p.role)) {
    problems.push(`${row}: role must be one of ${ROLES.join(', ')}, got ${JSON.stringify(p.role)}`);
  }
  if (p.managerEmail && !p.managerEmail.includes('@')) {
    problems.push(`${row}: managerEmail "${p.managerEmail}" doesn't look like an email`);
  }
  const key = p.email?.trim().toLowerCase();
  if (key && byEmail.has(key)) {
    problems.push(`${row}: duplicate email ${key} — already used by ${byEmail.get(key)}. `
      + `Emails are unique, so one of these rows must change.`);
  } else if (key) byEmail.set(key, p.name);
}
// managerEmail must resolve to someone else IN this roster, or already in
// the database — checked properly in the second pass; here we only catch
// the cheap self-reference mistake up front.
for (const [i, p] of people.entries()) {
  if (p.managerEmail && p.email && p.managerEmail.trim().toLowerCase() === p.email.trim().toLowerCase()) {
    problems.push(`row ${i + 1} (${p.name}): managerEmail cannot be the person's own email`);
  }
}

if (problems.length) {
  console.error('\nRoster has problems — nothing was changed:\n');
  problems.forEach((p) => console.error('  ·', p));
  process.exit(1);
}

// Does this person already have a Cognito account? Asked per person rather
// than by listing the whole pool: ListUsers pages, and assuming one page
// covers everyone would start mis-reporting people as "new" — and resetting
// their password — the moment the pool outgrew a page.
async function cognitoSubFor(email) {
  if (!hasCognito) return null;
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: email }));
    return res.UserAttributes?.find((a) => a.Name === 'sub')?.Value ?? null;
  } catch (err) {
    if (err.name === 'UserNotFoundException') return null;
    throw err;
  }
}

async function upsertPerson({ sub, email, name, team, role, department, seesAllProjects }) {
  const { rows } = await db.query(
    `insert into people (cognito_sub, email, name, team, role, department, sees_all_projects, active)
     values ($1,$2,$3,$4,$5,$6,$7,true)
     on conflict (email) do update
        set name              = excluded.name,
            team              = excluded.team,
            role              = excluded.role,
            department        = excluded.department,
            sees_all_projects = excluded.sees_all_projects,
            active            = true,
            cognito_sub       = coalesce(excluded.cognito_sub, people.cognito_sub)
     returning id`,
    [sub, email, name, team, role || 'member', department || null, seesAllProjects || false]
  );
  return rows[0].id;
}

// ── Report, then (optionally) act ────────────────────────────────────────────
async function main() {
  if (!hasCognito) {
    console.error('COGNITO_USER_POOL_ID is not set — this would create people rows with no');
    console.error('accounts behind them, and nobody could sign in. Set it in ../.env.');
    process.exit(1);
  }

  console.log(`\n${APPLY ? 'Onboarding' : 'DRY RUN —'} ${people.length} people\n`);
  const results = [];
  const idByEmail = new Map(); // filled in as we go, used by the manager pass below

  for (const p of people) {
    const email = p.email.trim().toLowerCase();
    const name = p.name.trim();
    const department = (p.department || '').trim() || null;
    const seesAllProjects = p.seesAllProjects === true;
    const existingSub = await cognitoSubFor(email);

    if (!APPLY) {
      console.log(`  ${existingSub ? 'update' : 'create'}  ${email.padEnd(32)} ${name} · [${p.team}/${p.role || 'member'}]${p.managerEmail ? ` → reports to ${p.managerEmail}` : ''}`);
      continue;
    }

    if (existingSub) {
      // Never reset a password for someone who already has an account — they
      // may already be using it. Only bring team/role/department up to date.
      const id = await upsertPerson({ sub: existingSub, email, name, team: p.team, role: p.role, department, seesAllProjects });
      idByEmail.set(email, id);
      results.push({ email, name, outcome: 'updated (password untouched)' });
      continue;
    }

    let inviteError = null;

    // Preferred path: Cognito emails the invitation itself and the account
    // stays in FORCE_CHANGE_PASSWORD, so the temporary value is single-use.
    if (!SHARED) {
      try {
        const created = await cognito.send(new AdminCreateUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
          DesiredDeliveryMediums: ['EMAIL'],
          UserAttributes: [
            { Name: 'email',          Value: email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'name',           Value: name },
          ],
        }));
        const sub = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value ?? null;
        const id = await upsertPerson({ sub, email, name, team: p.team, role: p.role, department, seesAllProjects });
        idByEmail.set(email, id);
        results.push({ email, name, outcome: 'invited by email' });
        continue;
      } catch (err) {
        // Fall through to a printed password. Onboarding should not be
        // blocked because SES is still in the sandbox or a sender is
        // unverified — but the person running this is told which happened,
        // per person, rather than the script claiming an email went out.
        inviteError = err.message;
      }
    }

    const pw = SHARED ? process.env.DEMO_PASSWORD : tempPassword();
    if (SHARED && !pw) { console.error('--shared-password needs DEMO_PASSWORD in ../.env'); process.exit(1); }

    try {
      const created = await cognito.send(new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        MessageAction: 'SUPPRESS',
        TemporaryPassword: pw,
        UserAttributes: [
          { Name: 'email',          Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name',           Value: name },
        ],
      }));
      const sub = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value ?? null;

      if (SHARED) {
        await cognito.send(new AdminSetUserPasswordCommand({
          UserPoolId: USER_POOL_ID, Username: email, Password: pw, Permanent: true,
        }));
      }

      const id = await upsertPerson({ sub, email, name, team: p.team, role: p.role, department, seesAllProjects });
      idByEmail.set(email, id);
      results.push({
        email, name,
        outcome: SHARED ? 'created with the shared password' : 'temporary password (invite email failed)',
        password: SHARED ? null : pw,
        reason: inviteError ?? undefined,
      });
    } catch (err) {
      results.push({ email, name, outcome: `FAILED: ${err.message}` });
    }
  }

  if (!APPLY) {
    console.log('\nNothing was changed. Re-run with --apply to create these accounts.');
    return;
  }

  // ── Second pass: resolve managerEmail -> manager_id ──────────────────────
  // manager_id is self-referencing (people.manager_id -> people.id), so this
  // can only run after every row above has an id. Also resolves against
  // anyone already in the database (not just this roster), so a partial
  // re-run (only new hires) still links correctly to an existing manager.
  console.log('\nLinking manager_id from managerEmail…');
  for (const p of people) {
    if (!p.managerEmail) continue;
    const email = p.email.trim().toLowerCase();
    const managerEmail = p.managerEmail.trim().toLowerCase();
    let managerId = idByEmail.get(managerEmail);
    if (!managerId) {
      const { rows } = await db.query('select id from people where lower(email) = $1', [managerEmail]);
      managerId = rows[0]?.id;
    }
    if (!managerId) {
      console.warn(`  ! ${email}: managerEmail ${managerEmail} not found — left unlinked`);
      continue;
    }
    await db.query('update people set manager_id = $1 where lower(email) = $2', [managerId, email]);
  }

  console.log('\n── Results ──');
  for (const r of results) console.log(`  ${r.email.padEnd(32)} ${r.outcome}`);

  const needPw = results.filter((r) => r.password);
  if (needPw.length) {
    console.log('\n── Temporary passwords — share each one privately, then delete this output ──');
    console.log(`   (the invite email could not be sent: ${needPw[0].reason})`);
    for (const r of needPw) console.log(`  ${r.email.padEnd(32)} ${r.password}`);
    console.log('\n   Each person must set their own password on first sign-in.');
  }
}

main()
  .then(async () => { await db.end(); process.exit(0); })
  .catch(async (e) => { console.error(e); await db.end().catch(() => {}); process.exit(1); });
