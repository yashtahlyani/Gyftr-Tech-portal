// db.js — RDS Postgres connection pool
// Credentials come from env vars, or AWS Secrets Manager if AWS_SECRET_NAME is set.
// Pattern mirrors the gyftr-legal/gyftr-portal sibling migrations — see infra/aws-setup.md.

import pg from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { readFile, readdir } from 'fs/promises';
import { fileURLToPath } from 'url';

const { Pool } = pg;
let pool;

async function getDbCredentials() {
  if (process.env.AWS_SECRET_NAME) {
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'ap-south-1' });
    const res = await client.send(new GetSecretValueCommand({ SecretId: process.env.AWS_SECRET_NAME }));
    const secret = JSON.parse(res.SecretString);
    return {
      host:     secret.host,
      port:     secret.port || 5432,
      database: secret.dbname,
      user:     secret.username,
      password: secret.password,
    };
  }
  return {
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
}

// Applies sql/*.sql in filename order on every boot — mirrors
// gyftr-ceo-portal/backend/db.js's applyMigrations() exactly (see
// backend/sql/01_schema.sql's header for why this app's sql/ directory
// only has one numbered file today). Every statement is idempotent
// (IF NOT EXISTS / OR REPLACE / a do-block swallowing duplicate_object),
// so this is a no-op against an already-current database — deploying is
// just a restart, nobody has to remember to hand-run psql.
//
// Each file runs as ONE pool.query, so it is implicitly a single
// transaction — a syntax error halfway through a file rolls that whole
// file back rather than leaving the schema half-applied.
//
// Unlike gyftr-legal's applySeed(), there is no automatic seed step here:
// this app's real directory is a multi-hundred-row org hierarchy migrated
// via scripts/aws-migration/migrate-db.mjs, not a handful of fixed
// accounts safe to hand-run on every boot. Local/demo data is opt-in via
// scripts/seed.mjs — see that file, and backend/sql/01_schema.sql's old
// seed.sql note.
async function applyMigrations() {
  const dir = fileURLToPath(new URL('./sql/', import.meta.url));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = await readFile(dir + file, 'utf8');
    try {
      await pool.query(sql);
      console.log(`[db] Applied ${file}`);
    } catch (err) {
      // Name the file — a bare Postgres error with no filename is a
      // genuinely miserable thing to debug against several hundred lines
      // of DDL.
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
  console.log(`[db] ${files.length} migration(s) applied (idempotent)`);
}

// Init state, so the API can answer "why is this broken?" instead of dying.
let _ready = false;
let _lastError = null;

export const isDbReady = () => _ready;
export const dbLastError = () => (_lastError ? _lastError.message : null);

/**
 * Connect, retrying in the background forever.
 *
 * initDb() throwing must never kill the process: if it did, a transient RDS
 * problem would crash-loop the container, empty the target group, and the
 * ALB would serve a bare 503 with no information. Instead the API stays up
 * and says what is wrong (GET /health/deep), and recovers on its own when
 * the database comes back.
 */
export async function initDbWithRetry({ intervalMs = 10000 } = {}) {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      await initDb();
      _ready = true;
      _lastError = null;
      console.log(`[db] Ready (attempt ${attempt}).`);
      return;
    } catch (err) {
      _ready = false;
      _lastError = err;
      console.error(`[db] Not ready (attempt ${attempt}): ${err.message}`);
      if (attempt === 1) {
        console.error('[db] The API is up and will keep retrying. GET /health/deep for the current reason.');
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }
}

export async function initDb() {
  const creds = await getDbCredentials();

  if (!creds.host || !creds.database || !creds.user || !creds.password) {
    throw new Error(
      'Database not configured. Set DB_HOST, DB_NAME, DB_USER, DB_PASSWORD ' +
      '(or AWS_SECRET_NAME for Secrets Manager).'
    );
  }

  pool = new Pool({
    ...creds,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  const client = await pool.connect();
  console.log('[db] Connected to RDS Postgres:', creds.host);
  client.release();
  await applyMigrations();
}

export function query(sql, params) {
  if (!pool) throw new Error('DB not initialized — call initDb() first');
  return pool.query(sql, params);
}

// projects PATCH (stage transitions + stage_history insert + involved_teams
// fold, see projectScope.js) and project create (project row + subtasks +
// "Project created" history) each need multiple statements to succeed or
// fail together — this is what used to be one atomic Postgres trigger firing
// alongside the RLS-checked UPDATE/INSERT; here it's a real transaction.
export async function withTransaction(fn) {
  if (!pool) throw new Error('DB not initialized — call initDb() first');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
