# AWS provisioning — Gyftr Tech Portal

First-time setup only. For a routine release see [`../DEPLOY.md`](../DEPLOY.md).

This mirrors the Marketing, Legal and CEO Office portals closely. If you have
provisioned any of those, this will feel familiar — the differences from the
CEO Office portal specifically are called out in boxes, because that one
enforces authorization differently from this one (see [`../DATABASE.md`](../DATABASE.md)).

---

## What you are deploying

```
        browser
           │
           ├──► ALB ──► ECS (Fargate, arm64) ──► frontend :8979
           │              serves the built React bundle.
           │              No secrets, no database, no state.
           │
           └──► ALB ──► ECS (Fargate, arm64) ──► backend :8978
                          │
                          ├──► RDS Postgres      all data
                          ├──► Cognito           token verification
                          ├──► S3 (private)      attachment bytes (optional)
                          └──► Secrets Manager   database credentials
```

> **The difference from the CEO Office portal.** That one decides permissions
> in Postgres Row-Level Security. **This one decides them in Express
> middleware** (`backend/authz.js`) — the same convention Marketing and Legal
> use. For provisioning this changes one thing, in §2: there is **no**
> `authenticated`-role / RLS-ownership dance, and `infra/dba-setup.sql` is a
> few lines instead of a five-step handover. Everything else below is the
> same shape as any sibling.

---

## 1. ECR

Two repositories:

```bash
for repo in gyftr-tech-portal-frontend gyftr-tech-portal-backend; do
  aws ecr create-repository \
    --repository-name $repo \
    --region $AWS_DEFAULT_REGION \
    --image-scanning-configuration scanOnPush=true
done
```

Both builds should pull the shared ARM base image used by the sibling
portals, if one exists in your account (the platform account's Node image —
check the CEO Office / Legal buildspecs for the exact URI in use). The
CodeBuild role needs `ecr:GetAuthorizationToken` plus pull permission on that
account.

---

## 2. RDS

- **Engine:** PostgreSQL 16 (matches the siblings; the schema itself only
  requires 13+ for `gen_random_uuid()` — see `backend/sql/01_schema.sql`)
- **Instance:** `db.t4g.micro` is ample for this app's working set
- **Database name:** `gyftr_tech`
- **Public access:** no. Only the backend's security group reaches 5432
- Store the credentials in **Secrets Manager** (e.g. `gyftr/tech/db`) with
  the standard RDS shape: `host`, `port`, `dbname`, `username`, `password`

**No migration step for the application.** The backend applies
`backend/sql/*.sql` on every boot and every statement is idempotent, so the
schema builds itself the first time the service starts (see `backend/db.js`).

> ### One thing to run by hand first, as the RDS master user
>
> ```bash
> psql "host=<rds-endpoint> dbname=<tech-db> user=<master> sslmode=require" \
>      -v app_user=<the user the backend connects as> \
>      -f infra/dba-setup.sql
> ```
>
> Unlike the CEO Office portal's `dba-setup.sql`, this one does **not**
> install an extension, create a role, or hand over RLS-policy ownership —
> this app has no RLS to own. It only makes sure the backend's database user
> can create tables/sequences/enum types in its own database, which on a
> freshly created RDS instance where that user already owns the database is
> typically already true. See the file's own header for exactly why it's
> this short.
>
> Run it before the first deploy anyway — it's idempotent and cheap, and it
> is the one step an application-level user genuinely cannot do for itself
> if the database was created by someone else on its behalf.
>
> Afterwards, `cd scripts && node doctor.mjs` reports the state of the
> database in one pass — connection, every table's existence, and Cognito
> reachability. Use it instead of redeploying to find the next problem.

### One-time data migration from the live Supabase database

This app (unlike the CEO Office portal, which was greenfield) has a real,
currently-live Supabase database to carry over. Once RDS is reachable and
`dba-setup.sql` has run:

```bash
cd scripts
SUPABASE_DB_URL="postgres://...supabase.co:5432/postgres" node aws-migration/migrate-db.mjs --dry-run
SUPABASE_DB_URL="postgres://...supabase.co:5432/postgres" node aws-migration/migrate-db.mjs
node aws-migration/create-cognito-users.mjs
```

See `scripts/aws-migration/migrate-db.mjs`'s header for exactly what it
copies and in what order. **This has not been run against the live database
by anyone building this migration** — no Supabase or AWS credentials were
available in that environment. Dry-run it against a staging copy of the live
data before trusting it against production.

---

## 3. Cognito

- **User pool:** one, e.g. `gyftr-tech-portal`
- **Sign-in:** email
- **App client:** **no client secret.** A browser cannot keep one — the
  symptom of getting this wrong is an opaque `NotAuthorizedException` that
  looks exactly like a wrong password
- **Auth flows:** enable `ALLOW_USER_PASSWORD_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH`
- **Password policy:** the default (8+, upper, lower, digit, symbol) matches
  what `scripts/lib.mjs`'s generated temporary passwords satisfy
- **Email:** configure SES, and take the account **out of the SES sandbox**
  before onboarding real people — in the sandbox only verified addresses
  receive mail, so invitations silently fail for everyone else

Per the approved migration plan, login uses **real Cognito accounts with
passwords** (a shared temporary password + forced reset on first login for
the initial cutover via `create-cognito-users.mjs`, or per-person invites via
`onboard.mjs` / `create-person.mjs` going forward) — not a passwordless
picker. Accounts are created in `FORCE_CHANGE_PASSWORD`, so a temporary
password is single-use and every person chooses their own before reaching
the board.

---

## 4. S3 (optional — attachments)

Every attachment in the original Supabase-era schema was a caller-supplied
link (Google Doc / Figma / SharePoint URL), never an uploaded file — see
`backend/s3.js`'s header. This bucket is additive: it lets a team upload an
actual file instead of pasting a link. The app works without it; skip this
section for a first cut and add it later if real uploads are wanted.

```bash
aws s3api create-bucket \
  --bucket gyftr-tech-portal-attachments \
  --region $AWS_DEFAULT_REGION \
  --create-bucket-configuration LocationConstraint=$AWS_DEFAULT_REGION

aws s3api put-public-access-block \
  --bucket gyftr-tech-portal-attachments \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

> **This bucket must never be public.** Attachments are served through
> 60-second presigned URLs that the API mints only after re-checking the
> attachment's project through `canSee()`/`canAddAttachment()` in
> `backend/authz.js` — see `backend/routes/attachments.js`. That check is the
> *entire* access control on attachment bytes. If Block Public Access were
> off, it would be decorative: anyone who learned an object key could read
> it directly.

The backend's **task role** needs, scoped to this bucket only:

```
s3:PutObject, s3:GetObject, s3:DeleteObject   on arn:aws:s3:::gyftr-tech-portal-attachments/*
```

Plus `secretsmanager:GetSecretValue` on the database secret, and
`cognito-idp:AdminCreateUser`, `AdminSetUserPassword`, `AdminGetUser` on the
user pool (used by the admin scripts, and by any future in-app "invite"
flow).

If you skip this section, leave `ATTACHMENTS_BUCKET` unset on the backend
task — link-only attachments keep working with no S3 access at all.

---

## 5. CodeBuild

Two projects — one per image.

| Setting | Frontend | Backend |
|---|---|---|
| Buildspec | `frontend/buildspec.yml` | `backend/buildspec.yml` |
| Environment type | **ARM / Graviton** | **ARM / Graviton** |
| Privileged | enabled | enabled |

Frontend environment variables:

```
FRONTEND_IMAGE_REPO_NAME  = gyftr-tech-portal-frontend
FRONTEND_ECS_CONTAINER    = <container name in the task definition>
VITE_API_URL              = https://tech-api.gyftr.net
VITE_COGNITO_USER_POOL_ID = ap-south-1_XXXXXXXXX
VITE_COGNITO_CLIENT_ID    = <app client id, no secret>
```

Backend environment variables:

```
BACKEND_IMAGE_REPO_NAME = gyftr-tech-portal-backend
BACKEND_ECS_CONTAINER   = <container name in the task definition>
```

> The backend build takes **no** application configuration — the same image
> runs in UAT and production, and nothing secret is baked into it. The
> frontend needs its three because Vite compiles them into the bundle at
> build time; setting them on the running task afterwards does nothing.

An x86 CodeBuild environment fails confusingly: the image builds but will
not run on an arm64 task. Check this first if a task starts and immediately
dies with an exec-format error.

---

## 6. ECS

Two services in one cluster.

| | Frontend | Backend |
|---|---|---|
| Launch type | Fargate, ARM64 | Fargate, ARM64 |
| Task size | 0.25 vCPU / 0.5 GB | 0.5 vCPU / 1 GB |
| Container port | `8979` | `8978` |
| Task role | none needed | S3 (if used) + Secrets Manager + Cognito (§4) |
| Execution role | ECR pull + CloudWatch Logs | same |
| Environment | **none** — baked in at build | the runtime table in `../DEPLOY.md` |

The backend's security group must reach RDS on 5432, and RDS's must allow it.

---

## 7. Load balancer

| | Frontend | Backend |
|---|---|---|
| Target port | 8979 | 8978 |
| Health check | `/` | `/health` |
| Target type | ip | ip |

Healthy threshold 2, interval 30s, HTTPS listeners with ACM certificates.

- If the frontend serves via `serve -s` (or equivalent), confirm unknown
  paths rewrite to `index.html` — the SPA router needs it. If deep links 404
  while the home page works, that flag has been lost.
- The backend health check is **`/health`, not `/health/deep`.** `/health`
  is liveness and deliberately does not touch the database — see
  `backend/server.js`. Pointing the target group at `/health/deep` means a
  brief RDS blip deregisters every task at once and turns a degraded service
  into a total outage. `/health/deep` is for humans and scripts diagnosing a
  problem.

---

## 8. DNS

```
tech.gyftr.net       → frontend ALB
tech-api.gyftr.net    → backend ALB
```

Then make sure these agree, or the app will load and fail in confusing ways:

- `VITE_API_URL` on the **frontend build** = the API hostname
- `FRONTEND_URL` on the **backend task** = the site hostname (this is the
  CORS allow-list in `backend/server.js`; a mismatch shows up as a blocked
  preflight, which the browser reports only as an unhelpful "Failed to
  fetch")

---

## 9. Before go-live

- [ ] SES out of the sandbox, and one invitation verified end to end
- [ ] The app client confirmed to have **no client secret**
- [ ] S3 Block Public Access confirmed on all four settings (if the bucket is used)
- [ ] `scripts/aws-migration/migrate-db.mjs` run against a staging copy first,
      then against the real live Supabase database, then verified with
      `node doctor.mjs`
- [ ] `scripts/aws-migration/create-cognito-users.mjs` run for the migrated org
- [ ] Every migrated person's team/role/manager_id spot-checked against the
      live org before real work depends on it
- [ ] RDS automated backups on, with a retention period somebody has agreed to
- [ ] The old Supabase project and Vercel deployment decommissioned once
      this stack is verified — see `../HANDOVER.md` for the secrets to rotate

---

## Cost note

Both containers are small and idle-cheap; the meaningful line items are RDS
and the ALB. There is no third-party bill once Supabase/Vercel are
decommissioned — this system's cost appears entirely in the AWS invoice.
