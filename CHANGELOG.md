# Changelog

## v2.0.0 — AWS migration (code + infra runbook)

**Supabase and Vercel are being retired.** The platform moves to a
self-hosted AWS stack, in the same shape as the sibling Marketing, Legal and
CEO Office portals: two ECS Fargate services behind an ALB, RDS PostgreSQL,
Cognito, and an optional private S3 attachments bucket.

| Was | Is |
|---|---|
| Supabase Postgres | **RDS PostgreSQL 16** |
| Supabase Auth (profile-picker + shared password) | **AWS Cognito**, real per-person passwords, forced reset on first login |
| Supabase Realtime | **~7s poll** (documented trade-off — see ARCHITECTURE.md) |
| Supabase Storage (never actually used — links only) | **S3 + presigned URLs**, additive, link-only attachments still work |
| PostgREST + RLS (browser → database) | **Express API** (`backend/`, port 8978) |
| Vercel | **ECS Fargate behind an ALB** |

### The decision that shaped this

Unlike **gyftr-ceo-portal** (which kept Postgres Row-Level Security as its
security boundary through its own AWS migration), this app's authorization
moved to **Express middleware** (`backend/authz.js`), following the
**gyftr-legal** convention instead. See [PROJECT_PLAN.md](PROJECT_PLAN.md)
for the full reasoning; the short version is that this app's authorization
was already fully specified as a large, mature set of RLS policies and
SECURITY DEFINER functions in `supabase/schema.sql` — porting each policy
1:1 to a plain JS function with the same name and the same rule was lower
risk than re-deriving the same rules from scratch as new RLS policies during
an infrastructure migration.

Every original policy and function has a named counterpart in
`backend/authz.js` (see its header comment for the full mapping) or
`backend/projectScope.js` (the two former triggers). `frontend/src/roles.ts`,
the client-side mirror that already existed and was already proven correct
against the live RLS behaviour, supplied the actual algorithm for the
trickiest piece — `orgSubtreeIds()` — rather than re-deriving it from the
SQL recursive CTE.

### What's new relative to the pre-migration Supabase build

- **Real authentication.** Login was a name-picker performing a real
  `signInWithPassword` under the hood, with every account sharing one
  password. It's now individual Cognito accounts with individual passwords,
  matching the sibling portals.
- **A `pm_review` stage and Business-hierarchy hold carve-out** — see
  `backend/workflow.js` and `projectScope.js`'s Business branch — both
  ported from hierarchy/hold work already validated against the live schema
  before this migration began, not new logic invented during the migration.
- **Attachments can be real uploaded files**, not only pasted links —
  additive S3 support in `backend/s3.js`, gated by the same `canSee()`/
  `canAddAttachment()` checks that already governed the link-only version.
- **A one-time migration path for the live data** —
  `scripts/aws-migration/migrate-db.mjs` +
  `scripts/aws-migration/create-cognito-users.mjs` — because unlike a
  greenfield sibling, this app has a real production Supabase database to
  carry over, not just a demo roster to seed fresh.

### Honest notes

- **This migration's scope was code + infra runbook only.** No AWS or
  Supabase credentials were available in the environment it was built in —
  nothing was provisioned or cut over live. See [HANDOVER.md](HANDOVER.md)
  for exactly what's code-complete vs what needs a person with real AWS
  access to finish.
- **`scripts/aws-migration/migrate-db.mjs` has not been run against a live
  database.** Written carefully against the schema and reviewed for FK
  ordering, but this is stated plainly rather than implied to be verified —
  see HANDOVER.md §3 for the verification steps to run before trusting it
  against production.
- **A prior attempt at this exact migration existed and was reverted three
  times** (commit `8ceae47` and its reapplications), predating the
  hierarchy/subtree/hold/pm_review/business-hierarchy work this migration
  had to account for. This build is a rebuild from the current
  `supabase/schema.sql` (757 lines) and `src/roles.ts` (328 lines), not a
  restoration of that stale code.
- **No route-level static-analysis safety net yet.** gyftr-ceo-portal's
  migration added `tests/routes.test.mjs` to catch a route that bypasses its
  security layer. This app's equivalent gap (a route calling `query()`
  without the right `authz.js` guard) has no automated check yet — flagged
  explicitly in [SECURITY.md](SECURITY.md) for whoever adds the next route.
- **`supabase/` is deliberately untouched and not deleted.** It stays as
  migration reference (and the source `schema.sql` this port was checked
  against) until the live Supabase project is actually decommissioned — see
  HANDOVER.md.

### Verification

- `node --test tests/*.test.mjs` — 29 pure-function tests against
  `backend/authz.js` / `backend/projectScope.js`, passing.
- `scripts/*.mjs` and `scripts/aws-migration/*.mjs` pass `node --check`
  (syntax only — they need real AWS/DB credentials to run for real, which
  don't exist in this environment).
- `docker-compose.yml` structurally verified against the sibling portals'
  compose files (eyeballed; Docker was not available to run `docker compose
  config` in the environment this was built in — confirm before relying on it).
