#!/usr/bin/env node
/* ─── Run this right after ECS/RDS/Cognito are all up, before handing the
   app over to real users. Hits /health, logs in as one real person (via
   Cognito's admin auth flow — no browser needed), then does a couple of
   authenticated round trips. Requires Node 18+ (uses global fetch). ─── */
import "dotenv/config";
import {
  CognitoIdentityProviderClient, AdminInitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const required = ["API_URL", "COGNITO_USER_POOL_ID", "COGNITO_CLIENT_ID", "SMOKE_TEST_EMAIL"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(", ")}. Copy .env.example to .env and fill them in.`);
  process.exit(1);
}

const apiUrl = process.env.API_URL.replace(/\/$/, "");
const email = process.env.SMOKE_TEST_EMAIL;
const password = process.env.DEFAULT_PASSWORD || "default@123";

let passed = 0, failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`);
    failed++;
  }
}

async function main() {
  await check("GET /health", async () => {
    const res = await fetch(`${apiUrl}/health`);
    if (!res.ok) throw new Error(`status ${res.status}`);
  });

  const cognito = new CognitoIdentityProviderClient({ region: process.env.COGNITO_REGION });
  let token;
  await check(`Cognito login as ${email}`, async () => {
    const auth = await cognito.send(new AdminInitiateAuthCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      ClientId: process.env.COGNITO_CLIENT_ID,
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }));
    token = auth.AuthenticationResult?.IdToken;
    if (!token) throw new Error("no IdToken returned");
  });

  if (!token) {
    console.log(`\n${passed} passed, ${failed} failed — can't continue without a token.`);
    process.exit(1);
  }
  const authed = (path) => fetch(`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });

  await check("GET /api/me", async () => {
    const res = await authed("/api/me");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const me = await res.json();
    if (!me.id) throw new Error("response missing id");
  });

  await check("GET /api/people", async () => {
    const res = await authed("/api/people");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) throw new Error("empty directory");
  });

  await check("GET /api/projects", async () => {
    const res = await authed("/api/projects");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error("not an array");
  });

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
