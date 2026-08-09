#!/usr/bin/env node
/* ─── Creates a Cognito user for every row in RDS's `people` table (the live
   directory — run this AFTER migrate-db.mjs, not against src/seed.ts, which
   can be stale demo data) and links each one back via people.cognito_sub,
   which backend/middleware/auth.js uses to resolve a verified JWT to a
   person on every request.

   Every user gets the same permanent password (DEFAULT_PASSWORD, default
   "default@123") — this matches the app's one-click profile picker, which
   authenticates with this same shared password behind the scenes no matter
   whose name gets clicked. Safe to re-run: existing Cognito users are
   skipped (not recreated), and cognito_sub is (re)linked either way. ─── */
import "dotenv/config";
import {
  CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand,
  AdminGetUserCommand, UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import { connectRds } from "./rdsClient.mjs";

const required = ["COGNITO_USER_POOL_ID"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(", ")}. Copy .env.example to .env and fill them in.`);
  process.exit(1);
}

const cognito = new CognitoIdentityProviderClient({ region: process.env.COGNITO_REGION });
const userPoolId = process.env.COGNITO_USER_POOL_ID;
const password = process.env.DEFAULT_PASSWORD || "default@123";

function getSub(user) {
  return user.UserAttributes?.find((a) => a.Name === "sub")?.Value;
}

async function ensureCognitoUser(email) {
  try {
    const created = await cognito.send(new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      UserAttributes: [{ Name: "email", Value: email }, { Name: "email_verified", Value: "true" }],
      MessageAction: "SUPPRESS", // we set a permanent password directly, no invite email needed
    }));
    await cognito.send(new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId, Username: email, Password: password, Permanent: true,
    }));
    return { sub: getSub(created.User), created: true };
  } catch (err) {
    if (err instanceof UsernameExistsException) {
      const existing = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }));
      return { sub: getSub(existing), created: false };
    }
    throw err;
  }
}

async function main() {
  const client = await connectRds();
  let created = 0, skipped = 0, failed = 0;
  try {
    const { rows: people } = await client.query("select id, email, cognito_sub from people order by email");
    console.log(`Found ${people.length} people in RDS. Creating Cognito users (password: "${password}")…\n`);

    for (const person of people) {
      try {
        const { sub, created: wasCreated } = await ensureCognitoUser(person.email);
        if (!sub) throw new Error("Cognito didn't return a sub for this user");
        if (person.cognito_sub !== sub) {
          await client.query("update people set cognito_sub = $1 where id = $2", [sub, person.id]);
        }
        if (wasCreated) { created++; console.log(`  created  ${person.email}`); }
        else { skipped++; console.log(`  skipped  ${person.email} (already existed, linked)`); }
      } catch (err) {
        failed++;
        console.error(`  FAILED   ${person.email}: ${err.message}`);
      }
    }
  } finally {
    await client.end();
  }
  console.log(`\nDone. created=${created} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
