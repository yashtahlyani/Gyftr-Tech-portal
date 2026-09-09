// Create a single person account from the command line.
//   node create-person.mjs "Name" email@gyftr.net team role [department] [managerEmail]
//
// e.g.
//   node create-person.mjs "Priya Nair" priya.nair@gyftr.net product lead "Product" saurabh@gyftr.net
//
// [department] and [managerEmail] are optional — pass "-" to skip one and
// still supply the next. role defaults are NOT applied here (unlike
// ensurePerson()'s default of 'member') because this is an explicit,
// single-person tool: say the role you mean.
//
// Named create-person.mjs, not create-stakeholder.mjs (gyftr-ceo-portal's
// filename) — "stakeholder" isn't a concept in this app's domain (people are
// business/product/tech_spoc/development/design/qa/partner/leadership team
// members with member/lead/pmo/leadership/svp roles), so the generic name is
// the honest one. See this repo's HANDOVER.md for the naming note.
//
// Cognito emails an invitation with a temporary password; they set their own
// on first login. Mirrors how the sibling portals onboard people.
//
// For bulk onboarding use onboard.mjs against scripts/roster.json instead —
// this exists for one-off additions and for when the UI (once it grows an
// admin screen) is not the easiest path.
import { ensurePerson, db, hasCognito, TEAMS, ROLES } from './lib.mjs';

const [, , name, email, team, role, departmentArg, managerEmailArg] = process.argv;
if (!name || !email || !team || !role) {
  console.error('Usage: node create-person.mjs "<Name>" <email> <team> <role> [department] [managerEmail]');
  console.error(`  team: ${TEAMS.join(' | ')}`);
  console.error(`  role: ${ROLES.join(' | ')}`);
  process.exit(1);
}

if (!TEAMS.includes(team)) {
  console.error(`Invalid team "${team}" — must be one of: ${TEAMS.join(', ')}`);
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.error(`Invalid role "${role}" — must be one of: ${ROLES.join(', ')}`);
  process.exit(1);
}

if (!hasCognito) {
  console.error('COGNITO_USER_POOL_ID is not set — this would create a people row with no');
  console.error('account behind it, and the person could never sign in. Set it in ../.env.');
  process.exit(1);
}

const department = departmentArg && departmentArg !== '-' ? departmentArg : null;
const managerEmail = managerEmailArg && managerEmailArg !== '-' ? managerEmailArg.trim().toLowerCase() : null;

let managerId = null;
if (managerEmail) {
  const { rows } = await db.query('select id from people where lower(email) = $1', [managerEmail]);
  if (!rows[0]) {
    console.error(`No existing person with email ${managerEmail} — create the manager first, or pass "-" to skip.`);
    process.exit(1);
  }
  managerId = rows[0].id;
}

const id = await ensurePerson({ email, name, team, role, department, managerId });

console.log('✓ Person created/updated');
console.log('  name  :', name);
console.log('  email :', email);
console.log('  team  :', team);
console.log('  role  :', role);
if (department) console.log('  dept  :', department);
if (managerEmail) console.log('  manager:', managerEmail);
console.log('  id    :', id);
console.log('');
console.log('  Cognito has emailed them a temporary password (or created the account');
console.log('  outright if this person already existed). They will be asked to choose');
console.log('  their own password before they can reach the board.');

await db.end();
process.exit(0);
