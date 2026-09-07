/* ─── Postgres connection pool. Credentials come from AWS Secrets Manager
   (AWS_SECRET_NAME) when set; otherwise falls back to plain PG* env vars so
   local/dev runs against a normal Postgres instance don't need Secrets
   Manager at all. ─── */
const { Pool } = require("pg");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

let poolPromise = null;

async function loadSecretConfig(secretName) {
  const client = new SecretsManagerClient({ region: process.env.COGNITO_REGION || process.env.AWS_REGION });
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
  if (!process.env.PGHOST || !process.env.PGUSER || !process.env.PGPASSWORD) {
    throw new Error(
      "No AWS_SECRET_NAME set and PGHOST/PGUSER/PGPASSWORD are incomplete — set AWS_SECRET_NAME " +
      "to a Secrets Manager secret, or fill in all of PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD."
    );
  }
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE || "gyftr_tech_portal",
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  };
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = (async () => {
      const config = process.env.AWS_SECRET_NAME
        ? await loadSecretConfig(process.env.AWS_SECRET_NAME)
        : loadEnvConfig();
      const pool = new Pool({ ...config, max: 10 });
      pool.on("error", (err) => console.error("Unexpected idle client error", err));
      return pool;
    })();
  }
  return poolPromise;
}

/** Run `fn` with a client checked out from the pool inside one transaction —
 *  every route that touches more than one table (project + history, subtask
 *  + involved_teams growth, etc.) should go through this instead of issuing
 *  independent queries, which is exactly the race condition class the old
 *  Supabase two-request transition() pattern had to work around. */
async function withTransaction(fn) {
  const pool = await getPool();
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

async function query(text, params) {
  const pool = await getPool();
  return pool.query(text, params);
}

module.exports = { getPool, withTransaction, query };
