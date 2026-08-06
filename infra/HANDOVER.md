# Gyftr Tech Portal — AWS handover

**⚠️ This document contains real employee login information. Keep it somewhere access-controlled (a password manager shared with admins only, or a restricted Drive folder) — do not paste it into a general-audience doc or channel.**

Written for whoever is setting this up, assuming no prior context on how this app was built.

---

## What this app is

An internal project tracker (replaces a PM Activity List spreadsheet). React frontend, Express API, Postgres database, Cognito for logins. No third-party backend (Supabase/Vercel/Firebase) — everything runs on AWS.

## Architecture, in one picture

```
Browser → CloudFront → S3            (static frontend files)
Browser → ALB (HTTPS) → EC2 → RDS    (API + database, RDS has no public access)
Browser → Cognito                    (login — issues the token the frontend sends to the API)
```

## Credentials

| What | Value |
|---|---|
| Every user's login password | `default@123` (same for everyone — see "How logins work" below) |
| GitHub repo | `<FILL IN — your repo URL>` |
| RDS master username | `gyftr_admin` (password lives in Secrets Manager, secret name `gyftr-tech-portal/rds` — not written here) |
| RDS endpoint | `<FILL IN DURING SETUP — from RDS console, step 2 of aws-setup.md>` |
| Cognito User Pool ID | `<FILL IN DURING SETUP — step 4>` |
| Cognito App Client ID | `<FILL IN DURING SETUP — step 4>` |
| EC2 instance / API domain | `<FILL IN DURING SETUP — step 5/6>` |
| ALB DNS name | `<FILL IN DURING SETUP — step 6>` |
| CloudFront distribution / frontend domain | `<FILL IN DURING SETUP — step 7>` |
| S3 bucket (frontend) | `<FILL IN DURING SETUP — step 7>` |

## How logins work

There's no "forgot password" flow and no self-signup. Every account is created ahead of time by `scripts/aws-migration/create-cognito-users.mjs` with the same permanent password, `default@123`. The app's login screen is a one-click "pick your name" list — clicking a name signs in as that person using this shared password behind the scenes. This mirrors exactly how the old Supabase-based version worked (it also used one shared password for everyone); it is not a new weakening introduced by this migration.

## Everyone with a login (as of this migration)

| Name | Email | Team | Role |
|---|---|---|---|
| Anjali Gupta | anjali.gupta@gyftr.net | Business | Lead |
| Neha | neha@gyftr.net | Business | Lead |
| Priya Sharma | priya.sharma@gyftr.net | Business | Member |
| Rahul Joshi | rahul.joshi@gyftr.net | Business | Member |
| Saurabh | saurabh@gyftr.net | Product | Lead |
| Siddharth | siddharth@gyftr.net | Product | Lead |
| Yash Tahlyani | yash.tahlyani@gyftr.net | Product | Member |
| Rajneesh | rajneesh@gyftr.net | Tech SPOC | PMO |
| Anandita | anandita@gyftr.net | Tech SPOC | Lead |
| Deepak | deepak@gyftr.net | Tech SPOC | Member |
| Harshita | harshita@gyftr.net | Tech SPOC | Member |
| Pankaj | pankaj@gyftr.net | Tech SPOC | Member |
| Sameer | sameer@gyftr.net | Tech SPOC | Member |
| Anmol | anmol@gyftr.net | Development | Member |
| Raj | raj@gyftr.net | Development | Member |
| Vikas | vikas@gyftr.net | Development | Member |
| Rajkumar | rajkumar@gyftr.net | Design | Member |
| Karan | karan@gyftr.net | QA | Lead |
| Pooja | pooja@gyftr.net | QA | Member |
| Leadership | leadership@gyftr.net | Leadership | Leadership (read-only) |
| PMO Office | pmo@gyftr.net | Leadership | PMO |

Password for every row above: `default@123`. All emails must be on the `@gyftr.net` domain — the app rejects anything else at login.

## Setup steps

Full instructions are in `infra/aws-setup.md` — this doc doesn't repeat them. Order: RDS → Secrets Manager → Cognito → EC2 → ALB → S3/CloudFront → build+deploy frontend → run the three migration scripts in `scripts/aws-migration/` → smoke test.

## Deploying future changes

**Frontend** (any change under `src/`):
```bash
npm run build
aws s3 sync dist/ s3://<bucket> --delete
aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
```

**Backend** (any change under `backend/`): SSH into the EC2 instance, then:
```bash
cd app && git pull
cd backend && npm ci --omit=dev
pm2 restart gyftr-api
```

## Common changes

**Add a new person:** insert a row into the `people` table (RDS) with their name/email/team/role, then run `node scripts/aws-migration/create-cognito-users.mjs` again — it only creates logins for people who don't have one yet, so it's safe to re-run any time.

**Someone forgot who they're supposed to be / password confusion:** there's nothing to reset — everyone's password is always `default@123`. If you want per-person real passwords instead of the shared one, that's a bigger change (a proper login form + `AdminSetUserPassword` with `Permanent: false` so Cognito forces a change on first login) — not done here, flag it if you want it built.

**Change a person's team or role:** `update people set team = '...', role = '...' where email = '...'` directly in RDS. Takes effect on their next login (the frontend caches `/api/people` for the session).

**Add a new team or pipeline stage:** this touches more than data — `backend/authz.js`'s `STAGE_OWNER`, `backend/workflow.js`'s `TRANSITIONS`, and `src/workflow.ts`'s `STAGES`/`TRANSITIONS` all need the same change kept in sync by hand. Worth asking whoever built this (or a developer familiar with the code) before doing it solo.

## Troubleshooting

**Frontend loads but login fails for everyone:** check `VITE_COGNITO_USER_POOL_ID`/`VITE_COGNITO_CLIENT_ID` in the frontend's `.env` match what's actually in Cognito, and that the build was re-deployed after any `.env` change (env vars are baked in at build time, not read at runtime).

**Login works but the app shows "No portal access":** that person's Cognito account exists but isn't linked (`people.cognito_sub` is null or wrong) — re-run `create-cognito-users.mjs`, or check they're actually in the `people` table at all.

**API returns 401/403 on everything:** check the EC2 instance's `backend/.env` has the right `COGNITO_USER_POOL_ID`/`COGNITO_CLIENT_ID`/`COGNITO_REGION`, and that `pm2 restart gyftr-api` ran after any change (env vars are read at process start).

**API won't start / can't reach the database:** check the EC2 instance's IAM role can read the `gyftr-tech-portal/rds` Secrets Manager secret, and that `gyftr-rds-sg` (RDS's security group) allows inbound 5432 from `gyftr-api-sg` (EC2's security group).

**Changes don't show up after deploying the frontend:** CloudFront caches aggressively — confirm the invalidation (`aws cloudfront create-invalidation --paths "/*"`) actually ran and finished (check its status in the CloudFront console).

**Nobody logged in this session sees a teammate's change immediately:** expected — the app polls for updates every ~7 seconds instead of pushing them instantly (the old Supabase version had instant push; this was a deliberate simplification for the AWS rebuild). If instant sync turns out to matter, that's a real follow-up project (WebSockets), not a quick fix.
