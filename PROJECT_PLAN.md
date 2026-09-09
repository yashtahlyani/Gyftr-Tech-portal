# Project Plan — AWS Migration

## 1. The existing state, as found

Before any code was written, the surrounding products were read rather than
assumed:

- **This app's own `supabase/schema.sql`** (757 lines) — a mature schema with
  hierarchy-aware visibility (`orgSubtreeIds`, `subtree_owns`/`subtree_leads`),
  a Business-hold carve-out, a `pm_review` pipeline stage, and ~15 RLS
  policies + SECURITY DEFINER functions, all validated against real usage
  before this migration began.
- **`src/roles.ts`** (328 lines) — the client-side mirror of that same logic,
  already proven correct against the live RLS behaviour.
- **`gyftr-legal/backend`** — the primary convention reference for this
  migration: `/health` vs `/health/deep`, a retry-loop `db.js`, Secrets
  Manager support, `withTransaction`, and an `authz.js` with an explicit
  RLS-policy-inventory comment block. Chosen as primary because it's the
  most refined sibling and — critically — because it enforces authorization
  in Express middleware, the model this app also needed (see §2).
- **`gyftr-portal`** — secondary reference for scripts/ conventions
  (`create-cognito-users.js`, `force-password-reset.js`, `doctor.js`).
- **`gyftr-ceo-portal`** — the newest, most complete sibling. Primary
  reference for `scripts/`, `infra/`, and root-doc *structure and tone*
  (this document set mirrors its layout file-for-file) — but explicitly
  **not** followed on the one decision that matters most: how authorization
  is enforced. See §2.
- **A prior attempt at this exact migration** (commit `8ceae47`, reverted and
  reapplied three times) — reviewed, and found to predate all of the
  hierarchy/subtree/hold/pm_review/business-hierarchy work done on
  `supabase/schema.sql` and `roles.ts` since. Its code was stale and could
  not simply be restored; this migration is a rebuild from the current state.

---

## 2. The one decision that shaped everything: where does authorization live?

Three siblings, two different answers:

| | Marketing / Legal | CEO Office |
|---|---|---|
| Authorization | Express middleware | Postgres Row-Level Security |

**This app followed Marketing/Legal (Express middleware), not the CEO
Office's RLS.** The reasoning, in order of weight:

1. **This app's authorization was already fully specified, in SQL.**
   `supabase/schema.sql` already contained ~15 RLS policies and several
   SECURITY DEFINER helper functions, each one already validated against
   real usage (SVP/hierarchy subtree access, the Business-hold carve-out,
   coarse-team-leak isolation, Product-lead date-only edits). The job was to
   **port** a known-correct ruleset, not to design one. A 1:1 port to plain
   JS functions — same names, same logic, called explicitly where the
   policy used to fire — is a mechanical, checkable translation. Re-deriving
   the same rules as ~15 new RLS policies during an infrastructure migration
   would have meant re-proving correctness for logic that had already been
   proven, for no functional gain.
2. **`src/roles.ts` already existed and was already correct.** The trickiest
   piece of this whole system — `orgSubtreeIds()`, the manager-chain subtree
   walk — had a client-side implementation already validated against the
   live RLS behaviour. `backend/authz.js`'s `orgSubtreeIds()` is that
   function, ported verbatim (same algorithm, snake_case field names), not
   re-derived from the SQL recursive CTE. Reusing proven code is lower-risk
   than re-deriving it twice (once for RLS-equivalent SQL, once for a JS mirror).
3. **`gyftr-legal`'s pattern was the more recent, more refined convention
   available to copy from** — explicit RLS-policy-inventory-style comment
   blocks, `/health` vs `/health/deep`, retry-loop DB init, transactions via
   `withTransaction`. Following it meant this migration started from a
   proven shape rather than inventing one.

**The cost accepted.** There is no database-level safety net behind a route
that forgets to call the right `authz.js` guard — see [SECURITY.md](SECURITY.md)'s
"failure mode this design accepts" section. This is a real, named trade-off,
not an oversight: gyftr-ceo-portal's RLS gets this guarantee "for free" at
the cost of a much heavier DBA-setup and ownership story
(`infra/dba-setup.sql` there is five steps; this app's is two, mostly
because there's nothing RLS-shaped to hand ownership of — see that file's
own header). Whoever adds the next route needs to review it against
`SECURITY.md`'s guard table by hand; there is currently no automated check
equivalent to the CEO Office portal's `tests/routes.test.mjs`.

---

## 3. Confirmed with the user before building

- **Login becomes real Cognito accounts with passwords** (shared temporary
  password + forced reset on first login for the initial org migration,
  matching `gyftr-portal`/`gyftr-legal` exactly) — not a passwordless picker.
- **Scope is code + infra runbook only.** No AWS credentials were available
  in the environment this was built in; nothing was provisioned or cut over
  live. `supabase/` stays untouched until a real cutover happens and is
  verified — see [HANDOVER.md](HANDOVER.md).

---

## 4. What was built

- `backend/` — Express API: `server.js`, `db.js`, `authz.js`,
  `projectScope.js`, `workflow.js`, `serialize.js`, `s3.js`, `errors.js`,
  `middleware/{auth,identity}.js`, `routes/*.js`, `sql/01_schema.sql`
- `frontend/` — rewritten against the Express API and
  `amazon-cognito-identity-js`, replacing `@supabase/supabase-js`
- `scripts/` — `lib.mjs`, `onboard.mjs`, `create-person.mjs`, `doctor.mjs`,
  `force-password-reset.mjs`, `seed.mjs`, `roster.example.json`,
  `aws-migration/{migrate-db,rdsClient,create-cognito-users}.mjs`
- `infra/aws-setup.md`, `infra/dba-setup.sql`
- `docker-compose.yml`, root `package.json`
- `tests/logic.test.mjs` — 29 tests against `backend/authz.js` /
  `backend/projectScope.js`, run and passing
- This document set

---

## 5. Testing strategy

**Pure-function unit tests only** (`tests/logic.test.mjs`), and this is a
deliberate, not a reduced, strategy. Every function in `backend/authz.js`
and `backend/projectScope.js` takes plain objects and returns a
boolean/throws — no database call inside either module. That means:

- **Testing the function directly IS testing the enforcement** — there is no
  separate "does the server actually apply this" layer to also test, the
  way an RLS-based sibling needs `tests/security.test.mjs` running through
  `set local role authenticated` against a real database to prove policies
  actually fire.
- **No database is needed to get real confidence.** This is a genuine
  advantage of the middleware model here, not a corner cut — see
  [DATABASE.md](DATABASE.md)'s "Verification" section.

Coverage is scoped to the trickiest logic, per the approved plan: subtree
computation and the coarse-team-leak flag (including which teams it does —
and pointedly does not — apply to), the broad/narrow `subtreeOwns`/
`subtreeLeads` split, `enforceProjectUpdateScope`'s column-level
restrictions (the Business-hold carve-out, the Product-lead date-only
carve-out), and stage-target ordering. Not exhaustive coverage of every
branch — genuine confidence in the parts most likely to be gotten wrong by a
future change, per the brief this migration followed.

---

## 6. Risks and known limitations

| Risk | Assessment |
|---|---|
| **No route-level static-analysis safety net** | Unlike gyftr-ceo-portal's `tests/routes.test.mjs`, there's no automated check that every route calls the right `authz.js` guard. Flagged in SECURITY.md as the one place this app's model asks more of code review than the RLS-based sibling. |
| **`migrate-db.mjs` unverified against live data** | Written and reviewed, not run — no credentials available. See HANDOVER.md §3 for the verification steps required before production use. |
| **No Realtime equivalent** | Frontend polls (~7s) instead of subscribing — documented trade-off, not a regression nobody noticed (see ARCHITECTURE.md). |
| **Attachments bucket is optional** | The app works with link-only attachments with zero S3 configuration; real uploads are an additive feature, not a hard dependency. |

---

## 7. Future enhancements (documented, not built)

- SLA breach alerts via a scheduled job comparing `stage_entered_at` against
  a per-stage day budget (same Phase 2 note the original Supabase-era schema carried)
- A route-level static-analysis test mirroring gyftr-ceo-portal's
  `tests/routes.test.mjs`, once this app's route count makes manual review
  of new routes against SECURITY.md's guard table unreliable
- Wiring the frontend up to the real-upload attachment endpoints that
  already exist in `backend/s3.js` / `backend/routes/attachments.js`
