// rdsClient.mjs — a bare pg Pool for the target RDS database, used only by
// scripts/aws-migration/migrate-db.mjs.
//
// Deliberately NOT ../lib.mjs's `db` export re-imported: lib.mjs's Pool is
// meant for the ordinary admin scripts (onboard/seed/doctor), which assume
// the schema is already applied (backend/db.js does that on boot). The
// migration script is a one-time, ordered bulk-copy against a database that
// may be completely fresh, so it gets its own small, explicit client rather
// than sharing state with scripts that have different assumptions.
//
// Same env vars as lib.mjs (DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD from
// ../.env), so both point at the same RDS instance without extra config.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });

const { Pool } = pg;

const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')} in ../../.env — this is the RDS side of the migration.`);
  process.exit(1);
}

export const rds = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 4,
});
