/* ─── Shared RDS connection helper for the migration scripts — same
   Secrets-Manager-first, env-var-fallback logic (and DB_* var naming) as
   backend/db.js, so every half of the app agrees on how to find the
   database. ─── */
import pg from "pg";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

async function loadSecretConfig(secretName) {
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || "ap-south-1" });
  const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
  const secret = JSON.parse(SecretString);
  return { host: secret.host, port: secret.port ?? 5432, database: secret.dbname ?? secret.database, user: secret.username, password: secret.password };
}

function loadEnvConfig() {
  const missing = ["DB_HOST", "DB_USER", "DB_PASSWORD"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(", ")} (or set AWS_SECRET_NAME instead).`);
    process.exit(1);
  }
  return { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, database: process.env.DB_NAME || "gyftr_tech_portal", user: process.env.DB_USER, password: process.env.DB_PASSWORD };
}

export async function connectRds() {
  const config = process.env.AWS_SECRET_NAME ? await loadSecretConfig(process.env.AWS_SECRET_NAME) : loadEnvConfig();
  const client = new pg.Client(config);
  await client.connect();
  return client;
}
