# Database

PostgreSQL 16 on RDS (13+ is the actual floor — `gen_random_uuid()` is core
in Postgres 13+, so no extension is needed). One migration file today,
applied by `backend/db.js` in filename order on every boot; every statement
is idempotent, so re-applying is a no-op. See
[`backend/sql/01_schema.sql`](backend/sql/01_schema.sql)'s own header for why
the directory is numbered (`01_...`) even though it currently holds only one
file — future schema changes land as new numbered files, not edits to this one.

---

## Read this if you also know the CEO Office portal

> **This app does NOT use Postgres Row-Level Security. There are no
> policies, no `SECURITY DEFINER` functions, no `authenticated` role, and no
> `SET LOCAL ROLE` anywhere in this codebase.**
>
> The sibling **gyftr-ceo-portal** enforces every access decision as a
> Postgres row predicate — RLS is that product's actual security boundary,
> and its `backend/db.js` connects as a non-owning role specifically so
> policies apply. **None of that exists here.** This app's backend connects
> to Postgres as an ordinary user with full table access (the same access
> level `scripts/*.mjs` also connect with — see `scripts/lib.mjs`'s header),
> and Postgres itself enforces nothing about who may see or change which
> row. **The entire authorization boundary is `backend/authz.js`**, called
> explicitly at the top of every route handler in `backend/routes/`.
>
> This is a deliberate choice, made when this app was migrated off Supabase,
> to follow the **gyftr-legal** convention (Express-middleware authorization)
> rather than the **gyftr-ceo-portal** convention (RLS) — see
> `backend/authz.js`'s header comment and `PROJECT_PLAN.md` for the
> reasoning. If you arrive here having just read the CEO Office portal's
> `DATABASE.md`, the one thing to unlearn is: **a query against this
> database returns everything that matches the WHERE clause you wrote, full
> stop.** There is no second, invisible filter under it. If a route's own
> `where` clause is wrong, or a route forgets to call an `authz.js` guard
> before reading/writing, nothing in Postgres catches that mistake.

---

## The authorization boundary, in one picture

```
route handler
  ├─ fetchAllPeople(query)              — needed by most authz.js checks
  │                                        (subtree computation, team leak)
  ├─ authz.js guard (canSee / canAct /
  │  canCreateProject / canManageSubtask / ...)  ← THIS is the check.
  │     throws / returns false -> route responds 403, query never runs
  │     returns true            -> route proceeds
  └─ query() / withTransaction() — plain SQL, no further filtering
```

Every function in `backend/authz.js` is a **pure function**: plain JS
objects in (a `people` row, a `projects` row with its `subtasks` nested),
a boolean or a thrown `Error` out. No database call inside `authz.js`
itself — the route fetches what it needs first, then asks `authz.js`
whether the actor may see/touch it. That's also why
[`tests/logic.test.mjs`](tests/logic.test.mjs) can assert real authorization
scenarios with zero database setup: testing the function directly **is**
testing the enforcement.

Full guard-by-guard detail, and the "what if a route just calls `query()`
directly" failure mode, is in [SECURITY.md](SECURITY.md).

---

## The one invariant that shapes everything

> **A project always has exactly one owning team** (`owner_team`) — the ball
> holder, recomputed from `stage` on every stage transition.

`involved_teams` — every team that has ever touched the project — only ever
grows, never shrinks, and is what most visibility checks key off (see
`canSee()` in `backend/authz.js`). Both columns are **denormalized for
authorization**, maintained by `backend/projectScope.js`'s
`syncProjectScope()` (the former `sync_project_scope()` trigger) — never
write them by hand from a route.

---

## Enums

| Type | Values |
|---|---|
| `team_id` | `business`, `product`, `tech_spoc`, `development`, `design`, `qa`, `partner`, `leadership` |
| `role_id` | `member`, `lead`, `pmo`, `leadership`, `svp` |
| `stage_id` | `intake`, `scoping`, `to_be_picked`, `development`, `pm_review`, `qa`, `uat`, `pre_prod`, `live` — **declared order IS pipeline order** everywhere (stage_targets sequencing, `backend/workflow.js`'s `STAGE_ORDER`) |
| `priority` | `P0`, `P1`, `P2` |

Adding an enum value requires `alter type ... add value ...` (a migration) —
see `backend/sql/01_schema.sql`'s header on the numbered-migrations
convention.

---

## Tables

### `people`
The org directory. `cognito_sub` starts null and is linked on first login by
`middleware/identity.js` (matching on verified email) — the replacement for
the old `claim_person()` RPC.

`id` · `cognito_sub` (unique) · `name` · `email` (unique) · `team` · `role`
(default `member`) · `manager_id` (self-referencing, any depth) ·
`department` (descriptive only — **not** used for authorization; `team` is)
· `sees_all_projects` (explicit, named grant — visibility only, not write
access) · `active` (false = retired; row stays for FK/history integrity but
must never appear as an assignment/owner candidate)

Indexes: `cognito_sub`, `manager_id`

`manager_id` drives `backend/authz.js`'s `orgSubtreeIds()` — every person id
in someone's reporting subtree, including themself, walking `manager_id`
down. This is what lets a manager see (or, in narrower cases, act on) their
whole branch's work, not just their own team's — ported verbatim from the
client-side algorithm that already existed in `frontend/src/roles.ts`.

### `projects`
The core row. `code` (`TP-###`) auto-generates from `projects_code_seq`.

Notable columns: `stage` (the pipeline lane, enum) + `status` (the
fine-grained state, free text) · `owner_id` (the person currently holding
it) · `owner_team` / `involved_teams` (**denormalized for authorization**,
see above — never write by hand) · the hold fields (`on_hold`,
`hold_reason`, `held_by_id`, `held_by_team`, `held_at` — an explicit pause,
separate from `blocked`/`block_reason`) · sheet-parity fields
(`priority_month`, `timeline_eta`, `dev_effort_days`, `reason_for_delay`,
`product_spoc_id`, `tech_lead_id`) · `final_go_live` (stamped automatically
by `projectScope.js` the moment `stage` becomes `live`).

Date naming in the UI: *Expected* = `target_go_live`, *Promised* =
`sacrosanct_go_live`, *Go Live Date* = `final_go_live`.

Indexes: `stage`, `involved_teams` (GIN, for the array-containment checks
`canSee()` does)

### `subtasks`
Per-project checklist item. `team` + optional `assignee_id`.
`expected_date` (set by the assigner), `promised_date` + `effort_days` (set
by the assignee — see `canManageSubtask()`'s own-row carve-out in
`authz.js`). Assigning a subtask to a new team folds that team into the
project's `involved_teams` (`syncSubtaskScope()` in `projectScope.js`).

Index: `project_id`

### `stage_targets`
One row per (project, stage): an expected date for reaching that stage.
`enforceStageTargetOrder()` in `projectScope.js` refuses an out-of-order date
(a later stage's target set before an earlier stage's).

Unique: `(project_id, stage)`

### `stage_history`
The immutable handoff ledger — who moved what, when, from where to where,
and why (`note`). Written inside the same transaction as the `projects`
UPDATE that caused it (see ARCHITECTURE.md's walkthrough of `PATCH
/api/projects/:id`), which is stronger than the original Supabase design's
separate fire-and-forget INSERT.

Index: `project_id`

### `comments`
`pinned` = a leadership/PMO priority note. `resolved` clears it. Anyone who
can see the project can comment (`canComment` = `canSee` in `authz.js`); only
the actor's own comment or an in-court/PMO actor may resolve/pin one
(`canResolveComment()`).

Index: `project_id`

### `attachments`
`url` — the original shape: every attachment in the Supabase-era schema was
a caller-supplied link (Google Doc / Figma / SharePoint URL), never an
uploaded file. `storage_key` is **additive**, not in the original schema:
set only when a real file was uploaded to S3 via `backend/s3.js`; null for
link-only attachments. When set, `routes/attachments.js` presigns a fresh
GET url on read rather than trusting a stored one — see SECURITY.md.

Index: `project_id`

---

## Row-level access control

There isn't any, at the database level. Restated once more because it's the
point of this document: **no table here has Row-Level Security enabled, and
none ever will as part of this app's design** — see the boxed note at the
top. The matrix a CEO-Office-style `DATABASE.md` would put here instead
lives in [SECURITY.md](SECURITY.md), expressed as "which `authz.js` function
gates which route," because that is where the actual decision is made.

---

## Verification

`backend/authz.js` and `backend/projectScope.js`'s logic is asserted by
[`tests/logic.test.mjs`](tests/logic.test.mjs) — pure-function unit tests,
no database required (see the file's header for why that's sufficient here
in a way it isn't for the RLS-based sibling, which needs a real database and
`set local role authenticated` to prove anything).
