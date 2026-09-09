// create-cognito-users.mjs — creates one Cognito account per active `people`
// row that doesn't have one yet, and writes cognito_sub back onto the row.
// Run once, after migrate-db.mjs has copied the real org into RDS.
//
// ── Why this is a standalone script and not just "run onboard.mjs" ─────────
// scripts/onboard.mjs is roster.json-driven: it reads a hand-maintained JSON
// file and creates/updates people rows plus Cognito accounts together. After
// migrate-db.mjs, the `people` table itself already holds the real,
// migrated org (with real ids, manager_id links, team/role) — there is no
// roster.json for this data and there shouldn't be one; re-deriving a JSON
// roster from the database just to feed it back to onboard.mjs would be a
// pointless round trip and a chance for the two copies to drift.
//
// So this script reads directly from RDS `people` (cognito_sub is null,
// active is true) and creates only the missing Cognito accounts — it never
// touches team/role/manager_id, only cognito_sub. It shares lib.mjs's
// `cognito`/`db` clients and the same temporary-password shape onboard.mjs
// uses, so the two scripts behave identically from Cognito's point of view;
// they just source their list of people differently.
//
//   cd scripts && node aws-migration/create-cognito-users.mjs --dry-run
//   cd scripts && node aws-migration/create-cognito-users.mjs
//
// Requires COGNITO_USER_POOL_ID in ../.env, same as every other script here.
import { db, cognito, USER_POOL_ID, hasCognito, temporaryPassword } from '../lib.mjs';
import { AdminCreateUserCommand, AdminSetUserPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';

const DRY_RUN = process.argv.includes('--dry-run');
// Mirrors migrate-db.mjs's plan-level note: creates accounts in
// FORCE_CHANGE_PASSWORD with a shared temp password (per the migration
// plan's "shared temp password + forced reset on first login" decision,
// same as onboard.mjs's --shared-password path), rather than emailing
// individual invitations — appropriate for a one-time bulk cutover of the
// whole existing org at once, where SES may not yet be configured.
const TEMP_PASSWORD = process.env.MIGRATION_TEMP_PASSWORD || process.env.DEMO_PASSWORD;

async function main() {
  if (!hasCognito) {
    console.error('COGNITO_USER_POOL_ID is not set in ../.env — nothing to create.');
    process.exit(1);
  }
  if (!TEMP_PASSWORD && !DRY_RUN) {
    console.error('Set MIGRATION_TEMP_PASSWORD (or DEMO_PASSWORD) in ../.env — the shared');
    console.error('temporary password every migrated account starts with (forced to change');
    console.error('on first login, per the migration plan).');
    process.exit(1);
  }

  const { rows: people } = await db.query(
    `select id, name, email from people where active and cognito_sub is null order by email`
  );

  console.log(`\n=== create-cognito-users — pool ${USER_POOL_ID} ===`);
  console.log(DRY_RUN ? 'Mode: DRY RUN\n' : 'Mode: LIVE\n');
  console.log(`${people.length} active people row(s) have no Cognito account yet.\n`);

  if (people.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let created = 0, failed = 0;
  for (const p of people) {
    const email = p.email.trim().toLowerCase();
    process.stdout.write(`  ${email.padEnd(32)} `);

    if (DRY_RUN) { console.log('would create'); created++; continue; }

    try {
      const pw = TEMP_PASSWORD || temporaryPassword();
      const res = await cognito.send(new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        MessageAction: 'SUPPRESS',
        TemporaryPassword: pw,
        UserAttributes: [
          { Name: 'email',          Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name',           Value: p.name },
        ],
      }));
      const sub = res.User?.Attributes?.find((a) => a.Name === 'sub')?.Value ?? null;
      await db.query('update people set cognito_sub = $1 where id = $2', [sub, p.id]);
      console.log('created');
      created++;
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Created: ${created}   Failed: ${failed}`);
  if (!DRY_RUN && created > 0) {
    console.log('\nEvery account starts on the shared temporary password and must set its');
    console.log('own on first sign-in (FORCE_CHANGE_PASSWORD). Communicate the password');
    console.log('through a secure channel, then delete it from wherever it was written down.');
  }
}

main()
  .then(async () => { await db.end(); process.exit(0); })
  .catch(async (err) => {
    console.error('create-cognito-users failed:', err.message);
    await db.end().catch(() => {});
    process.exit(1);
  });
