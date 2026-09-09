// Shared plumbing for the admin scripts.
//
// These connect DIRECTLY to Postgres as the owning user — this app has no
// Row-Level Security to bypass in the first place (see DATABASE.md and
// backend/authz.js's header), but the point still applies: these scripts run
// with full table access, on an operator's machine or a bastion, never in
// the app, and never in the browser. authz.js's checks only ever run inside
// the Express backend; nothing here goes through them.
//
// ── Two systems, one call ───────────────────────────────────────────────────
// Creating a person here means touching both Cognito (the account) and the
// `people` table (the row authz.js reads on every request). `ensurePerson()`
// below keeps that one call, mirroring gyftr-ceo-portal/scripts/lib.mjs's
// ensureUser() — adapted to this schema's columns (team/role/manager_id/
// department/sees_all_projects instead of role/title/must_set_password; see
// backend/sql/01_schema.sql's `people` table).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// These scripts run from scripts/, but the env file lives at the project
// root — load it explicitly rather than relying on the working directory.
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const { Pool } = pg;

const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')} in ../.env`);
  console.error('Copy ../.env.example to ../.env and fill them in.');
  process.exit(1);
}

export const db = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 4,
});

export const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;

export const cognito = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION || process.env.AWS_REGION || 'ap-south-1',
});

// Some scripts (a local database with no pool to talk to) only need people
// rows. Let them say so explicitly rather than failing deep inside an AWS
// call with an unhelpful credentials error.
export const hasCognito = Boolean(USER_POOL_ID);

// team_id / role_id enum values — must track backend/sql/01_schema.sql exactly.
export const TEAMS = ['business', 'product', 'tech_spoc', 'development', 'design', 'qa', 'partner', 'leadership'];
export const ROLES = ['member', 'lead', 'pmo', 'leadership', 'svp'];

export function temporaryPassword() {
  // Must satisfy Cognito's complexity policy: upper, lower, digit, symbol.
  return 'Gyftr@' + Math.random().toString(36).slice(2, 12) + '1!';
}

/**
 * Create (or update) a person: a Cognito account plus a `people` row.
 * Returns the person's id.
 *
 * `password`
 *   Given    → set as a PERMANENT password. Used by the demo seed so the
 *              accounts sign straight in.
 *   Omitted  → Cognito emails an invitation and the account stays in
 *              FORCE_CHANGE_PASSWORD, so the person sets their own.
 *
 * Idempotent on email (`on conflict (email) do update`): re-running never
 * resets an existing person's password, which is what makes onboard.mjs safe
 * to run against a database holding real work.
 *
 * Unlike gyftr-ceo-portal's ensureUser(), there is no `must_set_password`
 * column to keep in sync — this schema has none (see backend/sql/01_schema.sql).
 * The Cognito challenge state is the only gate; nothing here mirrors it into
 * the database for a UI to read.
 */
export async function ensurePerson({
  email, name, team, role = 'member', department = null, managerId = null,
  seesAllProjects = false, password, active = true,
}) {
  email = email.trim().toLowerCase();
  if (!TEAMS.includes(team)) throw new Error(`Invalid team "${team}" — must be one of: ${TEAMS.join(', ')}`);
  if (!ROLES.includes(role)) throw new Error(`Invalid role "${role}" — must be one of: ${ROLES.join(', ')}`);

  let sub = null;

  if (hasCognito) {
    try {
      const existing = await cognito.send(new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID, Username: email,
      }));
      sub = existing.UserAttributes?.find((a) => a.Name === 'sub')?.Value ?? null;
      // Deliberately does NOT touch the password of an account that already
      // exists — re-running an onboarding pass must never lock somebody out
      // of an account they have already set up.
    } catch (err) {
      if (err.name !== 'UserNotFoundException') throw err;

      const created = await cognito.send(new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        ...(password
          ? { MessageAction: 'SUPPRESS', TemporaryPassword: password }
          : { DesiredDeliveryMediums: ['EMAIL'] }),
        UserAttributes: [
          { Name: 'email',          Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name',           Value: name },
        ],
      }));
      sub = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value ?? null;

      if (password) {
        // Permanent: the demo accounts must sign straight in without a
        // first-login challenge, or every seeded login is a dead end.
        await cognito.send(new AdminSetUserPasswordCommand({
          UserPoolId: USER_POOL_ID, Username: email, Password: password, Permanent: true,
        }));
      }
    }
  }

  const { rows } = await db.query(
    `insert into people (cognito_sub, email, name, team, role, manager_id, department, sees_all_projects, active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (email) do update
        set name               = excluded.name,
            team               = excluded.team,
            role               = excluded.role,
            manager_id         = coalesce(excluded.manager_id, people.manager_id),
            department         = excluded.department,
            sees_all_projects  = excluded.sees_all_projects,
            active             = excluded.active,
            cognito_sub        = coalesce(excluded.cognito_sub, people.cognito_sub)
     returning id`,
    [sub, email, name, team, role, managerId, department, seesAllProjects, active]
  );

  return rows[0].id;
}

/** Remove a Cognito account. Used by seed.mjs's reset pass and by undoing a
 *  mistaken invite. */
export async function deleteUser(email) {
  if (!hasCognito) return;
  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: email }));
  } catch (err) {
    if (err.name !== 'UserNotFoundException') throw err;
  }
}
