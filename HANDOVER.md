# Handover

Everything a new maintainer needs on day one. Read this first; the other
docs go deeper once you know where things are.

---

## 1 · Where everything lives

| Thing | Location |
|---|---|
| **Code** | this repository (branch `main`) |
| **Live app (pre-migration)** | https://gyftr-tech-portal.vercel.app — **still the production system until someone with AWS access cuts over**, see §2 |
| **Supabase project (pre-migration, still live)** | see the previous KT.md / team notes for the project ref |
| **This migration's target** | AWS: two ECS Fargate services behind an ALB, RDS PostgreSQL, Cognito, an optional private S3 bucket |

> ⚠️ This repository may be public. No secret may ever be committed.
> `.gitignore` covers `.env*` and `scripts/roster.json`; keep it that way.

---

## 2 · What is code-complete in this worktree vs what needs real AWS access

This migration's scope was **code + infra runbook only** — there were no AWS
or Supabase credentials available in the environment it was built in, so
nothing was provisioned or cut over live. That constraint is inherited from
the approved migration plan; it is not an oversight.

### Done (verifiable without AWS access)

- [x] `backend/` — Express API, `authz.js`/`projectScope.js` (1:1 port of
      every RLS policy and trigger from `supabase/schema.sql`), routes,
      `backend/sql/01_schema.sql`
- [x] `frontend/` — React app rewritten against the Express API and Cognito
- [x] `scripts/` — `lib.mjs`, `onboard.mjs`, `create-person.mjs`,
      `doctor.mjs`, `force-password-reset.mjs`, `seed.mjs`,
      `roster.example.json`
- [x] `scripts/aws-migration/` — `migrate-db.mjs`, `rdsClient.mjs`,
      `create-cognito-users.mjs` — written and syntax-checked, **not run
      against live data** (see §3)
- [x] `docker-compose.yml`, root `package.json` — local dev stack
- [x] `infra/aws-setup.md`, `infra/dba-setup.sql` — first-time provisioning
      runbook, not executed against a real AWS account
- [x] `tests/logic.test.mjs` — pure-function tests against
      `backend/authz.js` / `backend/projectScope.js`, passing
- [x] This document set (README/ARCHITECTURE/DATABASE/SECURITY/DEPLOY/DEMO/
      CHANGELOG/PROJECT_PLAN)

### Needs someone with real AWS + Supabase access

- [ ] **Provision the AWS resources** in `infra/aws-setup.md` — RDS
      instance, Cognito user pool + app client, ECR repos, ECS cluster/
      services, ALB, security groups, optional S3 bucket
- [ ] **Run `infra/dba-setup.sql`** once against the fresh RDS instance
- [ ] **Run `scripts/aws-migration/migrate-db.mjs`** against the live
      Supabase database — dry-run against a staging copy first (see its own
      header for exactly what it does and does not verify)
- [ ] **Run `scripts/aws-migration/create-cognito-users.mjs`** to create
      Cognito accounts for the migrated org
- [ ] **Spot-check the migrated data** — team/role/manager_id for a sample
      of real people, and that project stage/owner_team/involved_teams look
      right — before anyone relies on it for real work
- [ ] **Cut DNS over** and run the verification checklist in
      [DEPLOY.md](DEPLOY.md) §5
- [ ] **Decommission Supabase and Vercel** once the AWS stack is verified

---

## 3 · The one-time data migration — read before running it

`scripts/aws-migration/migrate-db.mjs` copies `people`, `projects`,
`subtasks`, `stage_targets`, `stage_history`, `comments`, `attachments` from
the live Supabase Postgres into RDS, in FK-safe order, preserving primary
keys, `ON CONFLICT DO NOTHING` (safe to re-run after a partial failure).

It was **written carefully against `backend/sql/01_schema.sql` and reviewed
for correctness, but never run or tested against a live database** — there
were no Supabase or AWS credentials in the environment it was written in.
Before trusting it against production:

1. Dry-run it (`--dry-run`) against a **staging copy** of the live Supabase
   database, not production.
2. Compare row counts per table against the live Supabase counts.
3. Spot-check a handful of `people` rows for correct `manager_id` linking
   (it's a two-pass backfill — see the script's comment on why) and a
   handful of `projects` rows for correct `owner_team`/`involved_teams`.
4. Only then run it against production, followed immediately by
   `create-cognito-users.mjs` and `scripts/doctor.mjs`.

---

## 4 · Secrets to rotate once Supabase/Vercel are decommissioned

- Supabase project **anon key** and (if one was ever generated) **service-
  role key** — both are dead once the project is deleted, but a live key is
  a live key until then.
- Any **Supabase access token** used during development — it can reach every
  project the account owns, not just this one.
- Any **Vercel deploy tokens** used for this project.
- The **Cognito shared temporary password** used by
  `create-cognito-users.mjs` for the initial bulk cutover — once everyone
  has set their own password, that value should not be reused for anything.

None of these were captured or need repeating in this document — see
`SECURITY.md`'s "Secrets" section for where credentials live going forward
(Secrets Manager, gitignored `.env`/`roster.json`).

---

## 5 · Commands

```bash
npm run install:all      # frontend + backend + scripts
npm run dev:backend      # API with --watch, needs backend/.env
npm run dev:frontend     # dev server
npm run docker:up        # the whole stack: frontend :8979, backend :8978, postgres :5443
npm test                 # tests/*.test.mjs — pure logic, no database needed
npm run seed              # local/demo data
npm run onboard           # real roster, dry run by default
npm run doctor             # check a database + Cognito pool end to end
```

Admin scripts live in `scripts/` and talk to Cognito and the database
directly: `seed.mjs`, `onboard.mjs`, `create-person.mjs`,
`force-password-reset.mjs`, `doctor.mjs`, plus the one-time
`scripts/aws-migration/` tools (§3).

---

## 6 · Known deviations from the sibling portals' exact conventions

Two naming/structure choices worth knowing about, both explained in more
depth where they live:

1. **`scripts/create-person.mjs`**, not `create-stakeholder.mjs`. The CEO
   Office portal's domain has "stakeholders"; this app's domain has "people"
   on teams with roles — there is no "stakeholder" concept here, so the
   generic name is the accurate one. See the file's own header.
2. **`scripts/aws-migration/create-cognito-users.mjs` is a real, standalone
   script**, not a thin alias for `onboard.mjs`. It reads directly from the
   now-migrated RDS `people` table rather than `scripts/roster.json`, which
   is the correct data source for a one-time bulk cutover of an already-
   migrated org — see the file's own header for the full reasoning.

---

## 7 · Where to read next

| Question | File |
|---|---|
| How does it work internally? | [ARCHITECTURE.md](ARCHITECTURE.md) |
| What is the data model, and how is authorization enforced? | [DATABASE.md](DATABASE.md) |
| How is access actually enforced? | [SECURITY.md](SECURITY.md) |
| How do I demo it? | [DEMO.md](DEMO.md) |
| How do I deploy / provision AWS? | [DEPLOY.md](DEPLOY.md), [infra/aws-setup.md](infra/aws-setup.md) |
| Why was it built this way? | [PROJECT_PLAN.md](PROJECT_PLAN.md) |
| What changed recently? | [CHANGELOG.md](CHANGELOG.md) |
