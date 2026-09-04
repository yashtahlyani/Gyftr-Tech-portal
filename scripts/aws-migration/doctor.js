#!/usr/bin/env node
/* ─── External, credential-free stack diagnosis — same pattern as the
   sibling gyftr-portal/gyftr-legal projects' doctor.js. Walks the stack
   layer by layer (DNS → frontend → API liveness → API readiness →
   auth-enforcement → CORS) and prints a ranked, actionable problem list.
   Run this any time something "isn't working" and you don't know which
   layer to blame first.

   Usage: FRONTEND_URL=https://techportal.gyftr.net API_URL=https://techportal-api.gyftr.net node doctor.js ─── */
import { promises as dns } from "dns";
import "dotenv/config";

const FRONTEND = process.env.FRONTEND_URL;
const API = process.env.API_URL;
const problems = [];

function fail(check, detail, fix) {
  problems.push({ check, detail, fix });
  console.log(`  FAIL  ${check} — ${detail}`);
}
function ok(check) {
  console.log(`  OK    ${check}`);
}

async function checkDns(url, label) {
  if (!url) { fail(label, "no URL configured", `Set the corresponding env var and re-run.`); return; }
  try {
    const host = new URL(url).hostname;
    await dns.lookup(host);
    ok(`${label} DNS (${host})`);
  } catch (err) {
    fail(`${label} DNS`, err.message, `Check the domain is registered and its DNS record points at the right AWS resource.`);
  }
}

async function checkFrontendHttp() {
  if (!FRONTEND) return;
  try {
    const res = await fetch(FRONTEND);
    if (res.ok) ok("Frontend HTTP response");
    else fail("Frontend HTTP response", `status ${res.status}`, `Check the S3/CloudFront or ECS frontend service is actually serving content.`);
  } catch (err) {
    fail("Frontend HTTP response", err.message, `Check the frontend is deployed and its DNS/ALB/CloudFront routing is correct.`);
  }
}

async function checkHealth() {
  if (!API) return;
  try {
    const res = await fetch(`${API}/health`);
    const body = await res.json().catch(() => null);
    if (res.ok && body?.ok) ok("API /health (liveness)");
    else fail("API /health", `status ${res.status}`, `The API process itself isn't answering — check it's running (ECS task / pm2) at all.`);
  } catch (err) {
    fail("API /health", err.message, `Check API_URL is correct and the ALB/target group is routing to a running task.`);
  }

  try {
    const res = await fetch(`${API}/health/deep`);
    const body = await res.json().catch(() => null);
    if (res.ok && body?.ok) ok("API /health/deep (DB readiness)");
    else fail("API /health/deep", body?.error || `status ${res.status}`, `The API is up but can't reach RDS — check the security group (5432 from the API's SG), the Secrets Manager secret, and the IAM role's permission to read it.`);
  } catch (err) {
    fail("API /health/deep", err.message, `Same URL as /health failed differently — investigate the API logs directly.`);
  }
}

async function checkAuthEnforced() {
  if (!API) return;
  try {
    const res = await fetch(`${API}/api/projects`);
    if (res.status === 401) ok("API rejects anonymous requests (401)");
    else fail("API auth enforcement", `expected 401, got ${res.status}`, `Protected routes are not requiring auth — this is a real security bug, investigate immediately.`);
  } catch (err) {
    fail("API auth enforcement", err.message, `Couldn't even reach the API to check this.`);
  }
}

async function checkCors() {
  if (!API || !FRONTEND) return;
  try {
    const res = await fetch(`${API}/api/projects`, {
      method: "OPTIONS",
      headers: { Origin: FRONTEND, "Access-Control-Request-Method": "GET" },
    });
    const allowOrigin = res.headers.get("access-control-allow-origin");
    if (allowOrigin === FRONTEND || allowOrigin === "*") ok(`CORS allows ${FRONTEND}`);
    else fail("CORS", `Access-Control-Allow-Origin was "${allowOrigin}", expected "${FRONTEND}"`, `Check the API's FRONTEND_URL env var exactly matches the deployed frontend origin (scheme + host, no trailing slash).`);
  } catch (err) {
    fail("CORS preflight", err.message, `Couldn't reach the API to check this.`);
  }
}

async function main() {
  console.log(`Checking frontend: ${FRONTEND || "(not set)"}`);
  console.log(`Checking API:      ${API || "(not set)"}\n`);

  await checkDns(FRONTEND, "Frontend");
  await checkDns(API, "API");
  await checkFrontendHttp();
  await checkHealth();
  await checkAuthEnforced();
  await checkCors();

  console.log("");
  if (problems.length === 0) {
    console.log("Everything checks out.");
    return;
  }
  console.log(`${problems.length} problem(s) found:\n`);
  problems.forEach((p, i) => {
    console.log(`${i + 1}. ${p.check}`);
    console.log(`   ${p.detail}`);
    console.log(`   Fix: ${p.fix}\n`);
  });
  process.exit(1);
}

main();
