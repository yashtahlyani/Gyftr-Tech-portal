// Seed local/demo data so the portal feels alive immediately.
//
//   cd scripts && npm install && DEMO_PASSWORD=... node seed.mjs
//
// The roster below is first-name-only, inspired by (not copied verbatim
// from) the real demo cast already in frontend/src/seed.ts — team/role
// combinations covering business/product/tech_spoc/development/design/qa/
// leadership/pmo, plus a small manager_id hierarchy so subtree-visibility
// (orgSubtreeIds in backend/authz.js) has something real to demo against.
// Login emails are on @demo.gyftr.net (NOT real corporate mailboxes)
// because every demo account shares one password — the names are
// plausible, the credentials are throwaway.
//
// This script RESETS first (clears demo projects + @demo.gyftr.net
// accounts), so it is deterministic and safe to re-run. It connects as the
// database owner — see lib.mjs's header on why that's fine here (no RLS to
// bypass in the first place).
import { db, ensurePerson, deleteUser, hasCognito } from './lib.mjs';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
if (!DEMO_PASSWORD) {
  console.error('Missing DEMO_PASSWORD in ../.env');
  console.error('Set it to the password you want every demo account to share, then re-run.');
  process.exit(1);
}

// Without a user pool, ensurePerson() writes people rows and silently
// creates no Cognito accounts — producing a database full of people who
// cannot sign in and a demo that looks broken for a reason nothing reports.
if (!hasCognito) {
  console.error('COGNITO_USER_POOL_ID is not set in ../.env.');
  console.error('Seeding without it would create people rows with no accounts behind them,');
  console.error('and nobody could log in. Set it, then re-run.');
  process.exit(1);
}

// Relative to the day the seed RUNS, so "overdue" and "due today" stay true
// whenever someone demos this.
const today = new Date();
// Local calendar date, NOT toISOString() — that is UTC, and east of
// Greenwich it yields yesterday for most of the working day.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const some = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, Math.min(n, arr.length));

// ── Roster ────────────────────────────────────────────────────────────────
// `key` is used only within this script to wire up manager/owner references;
// it is never stored. managerKey is resolved to a real id after every
// person exists (manager_id is self-referencing, same two-pass shape as
// onboard.mjs).
const ROSTER = [
  { key: 'neha',      name: 'Neha',         team: 'business',    role: 'lead',       department: 'Business' },
  { key: 'anjali',     name: 'Anjali Gupta', team: 'business',    role: 'member',     department: 'Business',   managerKey: 'neha' },
  { key: 'priya',      name: 'Priya Sharma', team: 'business',    role: 'member',     department: 'Business',   managerKey: 'anjali' },
  { key: 'saurabh',    name: 'Saurabh',      team: 'product',     role: 'lead',       department: 'Product' },
  { key: 'siddharth',  name: 'Siddharth',    team: 'product',     role: 'member',     department: 'Product',    managerKey: 'saurabh' },
  { key: 'rajneesh',   name: 'Rajneesh',     team: 'tech_spoc',   role: 'pmo',        department: 'Technology', seesAllProjects: true },
  { key: 'anandita',   name: 'Anandita',     team: 'tech_spoc',   role: 'lead',       department: 'Project mgmt', managerKey: 'rajneesh' },
  { key: 'harshita',   name: 'Harshita',     team: 'tech_spoc',   role: 'member',     department: 'Technology', managerKey: 'anandita' },
  { key: 'raj',        name: 'Raj',          team: 'development', role: 'member',     department: 'Engineering', managerKey: 'anandita' },
  { key: 'anmol',      name: 'Anmol',        team: 'development', role: 'member',     department: 'Engineering', managerKey: 'anandita' },
  { key: 'rajkumar',   name: 'Rajkumar',     team: 'design',      role: 'member',     department: 'Design' },
  { key: 'pooja',      name: 'Pooja',        team: 'qa',          role: 'member',     department: 'QA' },
  { key: 'karan',      name: 'Karan',        team: 'qa',          role: 'lead',       department: 'QA' },
  { key: 'pmo',        name: 'PMO Office',   team: 'leadership',  role: 'pmo',        department: 'PMO',        seesAllProjects: true },
  { key: 'leadership', name: 'Leadership',   team: 'leadership',  role: 'leadership', department: 'Leadership', seesAllProjects: true },
];

const emailFor = (key) => `${key.replace(/_.*/, '')}@demo.gyftr.net`;
const SEEDED_EMAILS = new Set(ROSTER.map((p) => emailFor(p.key)));

const PROJECT_TITLES = [
  ['Loyalty points expiry banner', 'Amazon', 'Rewards'],
  ['Partner brand refresh — Q4', 'Flipkart', 'Rewards'],
  ['Voucher redemption bugfix', 'Myntra', 'Redemption'],
  ['New B2B bulk-order flow', 'Corporate Gifting', 'B2B'],
  ['Gift card balance API v2', 'Amazon', 'Cards'],
  ['Partner onboarding self-serve', 'New Partner', 'Onboarding'],
  ['Checkout page A/B test', 'Myntra', 'Growth'],
  ['SPOC dashboard revamp', 'Internal', 'Internal Tools'],
  ['Fraud-check rule update', 'Internal', 'Risk'],
  ['Mobile app deep-link fix', 'Flipkart', 'Mobile'],
];
const STAGES = ['intake', 'scoping', 'to_be_picked', 'development', 'pm_review', 'qa', 'uat', 'pre_prod', 'live'];
const STATUS_BY_STAGE = {
  intake: 'Scoping', scoping: 'Scoping', to_be_picked: 'Scoping',
  development: 'In Dev', pm_review: 'In Dev', qa: 'UAT', uat: 'UAT',
  pre_prod: 'Blocked', live: 'Live',
};

// ── Reset ─────────────────────────────────────────────────────────────────
async function reset() {
  console.log('Resetting existing demo data…');
  // Children first — these tables cascade from `projects` via FK, but
  // deleting explicitly keeps the order obvious and works even if a future
  // schema change drops a cascade.
  for (const t of ['comments', 'attachments', 'stage_history', 'stage_targets', 'subtasks', 'projects']) {
    await db.query(`delete from ${t}`);
  }
  if (hasCognito) {
    for (const email of SEEDED_EMAILS) await deleteUser(email);
  }
  await db.query('delete from people where lower(email) = any($1)', [[...SEEDED_EMAILS]]);
}

async function main() {
  await reset();

  console.log(`Creating ${ROSTER.length} demo accounts…`);
  const idByKey = new Map();
  for (const p of ROSTER) {
    const id = await ensurePerson({
      email: emailFor(p.key), password: DEMO_PASSWORD, name: p.name,
      team: p.team, role: p.role, department: p.department,
      seesAllProjects: p.seesAllProjects ?? false,
    });
    idByKey.set(p.key, id);
  }
  for (const p of ROSTER) {
    if (!p.managerKey) continue;
    const managerId = idByKey.get(p.managerKey);
    if (managerId) await db.query('update people set manager_id = $1 where id = $2', [managerId, idByKey.get(p.key)]);
  }

  const byId = (key) => idByKey.get(key);
  const devTeam = ['raj', 'anmol'];
  const qaTeam = ['pooja', 'karan'];

  console.log(`Creating ${PROJECT_TITLES.length} demo projects with subtasks/comments/history…`);
  for (let i = 0; i < PROJECT_TITLES.length; i++) {
    const [title, partner, lob] = PROJECT_TITLES[i];
    const stage = STAGES[i % STAGES.length];
    const status = STATUS_BY_STAGE[stage];
    const ownerId = stage === 'intake' ? byId('anjali')
      : stage === 'scoping' ? byId('siddharth')
      : stage === 'to_be_picked' ? byId('anandita')
      : (stage === 'development' || stage === 'pm_review') ? byId(pick(devTeam))
      : stage === 'qa' || stage === 'uat' ? byId(pick(qaTeam))
      : byId('anandita');
    const ownerTeam = stage === 'intake' ? 'business'
      : stage === 'scoping' || stage === 'pm_review' || stage === 'uat' ? 'product'
      : stage === 'to_be_picked' ? 'tech_spoc'
      : stage === 'development' || stage === 'pre_prod' ? 'development'
      : stage === 'qa' ? 'qa' : 'leadership';
    const involvedTeams = Array.from(new Set(['business', ownerTeam, 'product']));

    const { rows: [project] } = await db.query(
      `insert into projects
         (title, brd, partner, brand, lob, priority, bifurcation, stage, status,
          owner_id, business_owner_id, blocked, on_hold,
          owner_team, involved_teams, target_go_live, sacrosanct_go_live,
          product_spoc_id, tech_lead_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       returning *`,
      [
        title, '', partner, null, lob, pick(['P0', 'P1', 'P2']), pick(['B2B', 'B2C']),
        stage, status, ownerId, byId('anjali'), status === 'Blocked', false,
        ownerTeam, involvedTeams, addDays(7 + i * 3), addDays(10 + i * 3),
        byId('siddharth'), byId('raj'),
      ]
    );

    await db.query(
      `insert into stage_history (project_id, by_id, from_stage, to_stage, from_status, to_status, note)
       values ($1,$2,null,$3,null,$4,'Project created')`,
      [project.id, byId('anjali'), project.stage, project.status]
    );

    const subtaskCount = 1 + (i % 3);
    for (let s = 0; s < subtaskCount; s++) {
      const assignee = byId(pick([...devTeam, ...qaTeam, 'harshita']));
      await db.query(
        `insert into subtasks (project_id, title, team, assignee_id, done, expected_date, promised_date, effort_days)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          project.id, `Sub-task ${s + 1} for ${title}`, pick(['development', 'qa', 'design']),
          assignee, Math.random() < 0.4, addDays(2 + s), addDays(3 + s), 1 + (s % 5),
        ]
      );
    }

    if (Math.random() < 0.6) {
      await db.query(
        `insert into comments (project_id, by_id, text, pinned, resolved)
         values ($1,$2,$3,$4,false)`,
        [project.id, byId(pick(['anjali', 'saurabh', 'anandita'])), 'Please prioritize this for next sprint.', Math.random() < 0.2]
      );
    }
  }

  console.log('✓ Seed complete.');
  printLogins();
}

function printLogins() {
  console.log(`\n── Logins (password for all: the DEMO_PASSWORD in your .env) ──`);
  for (const p of ROSTER) {
    console.log(`  ${emailFor(p.key).padEnd(28)} ${p.name} · [${p.team}/${p.role}]${p.seesAllProjects ? '  (sees all)' : ''}`);
  }
}

main()
  .then(async () => { await db.end(); process.exit(0); })
  .catch(async (e) => { console.error(e); await db.end().catch(() => {}); process.exit(1); });
