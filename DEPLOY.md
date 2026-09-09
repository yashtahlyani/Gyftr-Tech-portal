# Deploying the Gyftr Tech Portal

Release runbook. For first-time AWS provisioning see
[`infra/aws-setup.md`](infra/aws-setup.md); for what's built vs what still
needs real AWS access see [`HANDOVER.md`](HANDOVER.md).

---

## Read this first — the shape of the system

| | Marketing | Legal | CEO Office | **Tech Portal** |
|---|---|---|---|---|
| Frontend container | ✅ 7867 | ✅ 7979 | ✅ 7868 | ✅ **8979** |
| Backend container | ✅ Express, 7878 | ✅ Express, 7978 | ✅ Express, 7869 | ✅ **Express, 8978** |
| Database | RDS Postgres | RDS Postgres | RDS Postgres | **RDS Postgres** |
| Auth | AWS Cognito | AWS Cognito | AWS Cognito | **AWS Cognito** |
| Authorization | Express middleware | Express middleware | **Postgres RLS** | **Express middleware** |
| File storage | — | S3 | S3 | **S3 (optional)** |

If you worked on this repository before this migration, you may remember a
Supabase project and a Vercel deployment. **Both are gone.** There is no
service-role key, no `supabase-js` import, and no Vercel build config
anywhere in this system as of this migration.

### The one way this could be confused with the CEO Office portal — and isn't

This app enforces authorization in **Express middleware**
(`backend/authz.js`), the same convention as Marketing and Legal — **not**
Postgres Row-Level Security. See [DATABASE.md](DATABASE.md) for the full
explanation; the practical difference for deployment is that there is no
`authenticated`-role / RLS-ownership dance in `infra/dba-setup.sql` here.

```js
// Every route, every guard, before touching the database:
if (!canSee(req.profile, project, allPeople)) throw new HttpError(403, '...');

// There is no second, database-level check behind this. Get it right here.
```

---

## What each image needs, and when

### Frontend — build time

Vite **compiles these into the JavaScript bundle**. They must be passed as
`--build-arg` / CodeBuild environment variables. Setting them on the running
task does nothing — the bundle is already built.

| Variable | Example |
|---|---|
| `VITE_API_URL` | `https://tech-api.gyftr.net` |
| `VITE_COGNITO_USER_POOL_ID` | `ap-south-1_XXXXXXXXX` |
| `VITE_COGNITO_CLIENT_ID` | the app client id — **created without a secret** |

All three are public by design: an address and two identifiers, shipped in a
file every visitor downloads. Security is the Cognito signature check on
every request and the `authz.js` guards behind it.

### Backend — run time

The backend takes **all** of its configuration at runtime — the same image
runs in UAT and production. See `backend/.env.example` for the full list:

| Variable | Notes |
|---|---|
| `PORT` | defaults to `8978` |
| `AWS_SECRET_NAME` | **preferred.** Secrets Manager id, e.g. `gyftr/tech/db` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | used only when `AWS_SECRET_NAME` is unset |
| `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID` | required — `middleware/auth.js` exits at boot without these two (the pool id's `ap-south-1_…` prefix is enough for it to find the right JWKS, so it needs no separate region variable) |
| `COGNITO_REGION` | optional, backend does not read it — only `scripts/lib.mjs`'s admin tooling does (falls back to `AWS_REGION`, then `ap-south-1`) |
| `ATTACHMENTS_BUCKET` | optional — private S3 bucket; link-only attachments work without it |
| `FRONTEND_URL` | the CORS allow-list. Never `*` |
| `NODE_ENV=production` | enables TLS to RDS |

---

## 1. Build and deploy

Two CodeBuild projects, same pattern as the siblings:

| | Buildspec | Project variables |
|---|---|---|
| Frontend | `frontend/buildspec.yml` | `FRONTEND_IMAGE_REPO_NAME`, `FRONTEND_ECS_CONTAINER`, the three `VITE_*` |
| Backend | `backend/buildspec.yml` | `BACKEND_IMAGE_REPO_NAME`, `BACKEND_ECS_CONTAINER` |

Both must be **ARM / Graviton** and **privileged**. Each writes
`imagedefinitions.json` for its ECS deploy stage.

Locally, the whole stack including a throwaway Postgres:

```bash
cp .env.example .env       # fill in the Cognito values
docker compose up --build  # → frontend :8979, backend :8978, postgres :5443
```

Health checks: `GET /` on 8979, `GET /health` on 8978.

---

## 2. Database

**There is no migration step for the application.** `backend/db.js` applies
`backend/sql/*.sql` in filename order on every boot. Every statement is
idempotent, so this is a no-op against an already-current database —
deploying is just a restart.

**A first-time database needs one manual step, as the RDS master user:**

```bash
psql "host=<rds-endpoint> dbname=<tech-db> user=<master> sslmode=require" \
     -v app_user=<the backend's DB user> \
     -f infra/dba-setup.sql
```

Much shorter than the CEO Office portal's equivalent — no extension, no
role, no RLS-ownership handover. See the file's own header for why.

To check the state of a database without redeploying to find out:

```bash
cd scripts && node doctor.mjs
```

### One-time: bring over the live Supabase data

This app, unlike a greenfield sibling, has real production data in the live
Supabase project. Once RDS is reachable:

```bash
cd scripts
SUPABASE_DB_URL="postgres://...supabase.co:5432/postgres" node aws-migration/migrate-db.mjs --dry-run
SUPABASE_DB_URL="postgres://...supabase.co:5432/postgres" node aws-migration/migrate-db.mjs
node aws-migration/create-cognito-users.mjs
```

Idempotent (`ON CONFLICT DO NOTHING`), so re-running after a partial failure
is safe — see the script's own header. **Not run or verified against live
data by this migration** — no Supabase/AWS credentials were available in
that environment. Dry-run against a staging copy first.

---

## 3. Cognito

1. **The app client must have no client secret.** With one, sign-in fails
   with an opaque `NotAuthorizedException` that looks like a wrong password.
2. **Email delivery must be configured** (SES out of the sandbox) before
   onboarding real people via per-person invites (`onboard.mjs`). The
   initial cutover (`create-cognito-users.mjs`) uses a shared temporary
   password instead and does not depend on SES.

New accounts are created in `FORCE_CHANGE_PASSWORD`, so the temporary value
is single-use and everyone picks their own password before reaching the
board.

---

## 4. Data

```bash
cd scripts && npm install

npm run seed        # local/demo data — RESETS demo projects + demo accounts
node onboard.mjs    # dry run against scripts/roster.json — shows, changes nothing
node onboard.mjs --apply
```

`seed` is destructive by design and is for demo/local dev only. `onboard`
never touches projects and never resets an existing person's password, so
it's the safe one to run against a database holding real work.

To put everyone back onto a temporary password:

```bash
node force-password-reset.mjs --dry-run   # preview
node force-password-reset.mjs --signout   # reset AND revoke live sessions
```

`scripts/roster.json` is **gitignored** — see `scripts/roster.example.json`.

---

## 5. Verify a release

```bash
node --test tests/*.test.mjs    # pure-function tests, no database needed
cd scripts && node doctor.mjs   # is this environment set up correctly?
```

Then in a browser:

- [ ] Sign in as a PMO account; every project loads
- [ ] Sign in as a team member; only involved-team / subtree-visible
      projects show
- [ ] A brand-new account is forced to set a password before reaching the board
- [ ] A project transition writes a `stage_history` row (Drawer → history tab)
- [ ] The Business-hold carve-out: a Business-team account can edit their
      project's fields but the hold toggle is refused (see SECURITY.md)

---

## Rollback

Images are immutable and tagged with a build number. Roll back by pointing
the ECS service at the previous task definition revision — no rebuild.

**Roll the two services back together.** They are versioned independently
but released as a pair, and a frontend expecting an endpoint an older
backend does not serve will fail in ways that look like a data problem.

**`backend/sql/` migrations do not roll back automatically** — they are
additive and idempotent by design, but rolling the backend image back also
rolls its `sql/` files back, and the old image re-applies them on boot. Take
an RDS snapshot before any release that changes `backend/sql/`.
