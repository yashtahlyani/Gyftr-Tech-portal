/* ─── Postgres connection pool. Credentials come from AWS Secrets Manager
   (AWS_SECRET_NAME) when set; otherwise falls back to plain DB_* env vars so
   local/dev runs against a normal Postgres instance don't need Secrets
   Manager at all. Same shape as the sibling gyftr-portal/gyftr-legal
   backends' db.js, so the three stay easy to cross-reference. ─── */
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

let pool = null;
let _ready = false;
let _lastError = null;

async function loadSecretConfig(secretName) {
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || "ap-south-1" });
  const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
  if (!SecretString) throw new Error(`Secret ${secretName} has no SecretString`);
  const secret = JSON.parse(SecretString);
  return {
    host: secret.host,
    port: secret.port ?? 5432,
    database: secret.dbname ?? secret.database,
    user: secret.username,
    password: secret.password,
  };
}

function loadEnvConfig() {
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD) {
    throw new Error(
      "No AWS_SECRET_NAME set and DB_HOST/DB_USER/DB_PASSWORD are incomplete — set AWS_SECRET_NAME " +
      "to a Secrets Manager secret, or fill in all of DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD."
    );
  }
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || "gyftr_tech_portal",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
}

async function applySchema() {
  const sql = fs.readFileSync(path.join(__dirname, "db", "schema.sql"), "utf8");
  await pool.query(sql);
}

/** Connects, verifies, and applies the (idempotent) schema. Throws on failure —
 *  callers should go through initDbWithRetry, not call this directly. */
async function initDb() {
  const config = process.env.AWS_SECRET_NAME
    ? await loadSecretConfig(process.env.AWS_SECRET_NAME)
    : loadEnvConfig();
  pool = new Pool({ ...config, max: 10, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
  pool.on("error", (err) => console.error("Unexpected idle client error", err));
  await pool.query("select 1"); // fail fast if creds/network are wrong, before touching schema
  await applySchema();
  _ready = true;
  _lastError = null;
}

/** Retries forever in the background rather than crash-looping the container —
 *  a transient RDS blip (or RDS not up yet on first boot) shouldn't kill the
 *  process; /health/deep reports the real state in the meantime. */
async function initDbWithRetry({ intervalMs = 10000 } = {}) {
  while (!_ready) {
    try {
      await initDb();
      console.log("Database ready.");
    } catch (err) {
      _lastError = err.message;
      console.error(`Database not ready yet (${err.message}) — retrying in ${intervalMs / 1000}s`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

const isDbReady = () => _ready;
const dbLastError = () => _lastError;

/** Run `fn` with a client checked out from the pool inside one transaction —
 *  every route that touches more than one table (project + history, subtask
 *  + involved_teams growth, etc.) should go through this instead of issuing
 *  independent queries, which is exactly the race condition class the old
 *  Supabase two-request transition() pattern had to work around. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function query(text, params) {
  if (!pool) throw new Error("Database pool not initialized yet");
  return pool.query(text, params);
}

/** For routes that need a raw client (or the pool itself) outside a transaction. */
function getPool() {
  if (!pool) throw new Error("Database pool not initialized yet");
  return pool;
}

module.exports = { initDbWithRetry, isDbReady, dbLastError, getPool, withTransaction, query };
