/* ─── Shared RDS connection helper for the migration scripts — same
   Secrets-Manager-first, env-var-fallback logic as backend/db.js, so both
   halves of the app agree on how to find the database. ─── */
import pg from "pg";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

async function loadSecretConfig(secretName) {
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
  const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
  const secret = JSON.parse(SecretString);
  return { host: secret.host, port: secret.port ?? 5432, database: secret.dbname ?? secret.database, user: secret.username, password: secret.password };
}

function loadEnvConfig() {
  const missing = ["PGHOST", "PGUSER", "PGPASSWORD"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(", ")} (or set AWS_SECRET_NAME instead).`);
    process.exit(1);
  }
  return { host: process.env.PGHOST, port: Number(process.env.PGPORT) || 5432, database: process.env.PGDATABASE || "gyftr_tech_portal", user: process.env.PGUSER, password: process.env.PGPASSWORD };
}

export async function connectRds() {
  const config = process.env.AWS_SECRET_NAME ? await loadSecretConfig(process.env.AWS_SECRET_NAME) : loadEnvConfig();
  const client = new pg.Client(config);
  await client.connect();
  return client;
}
