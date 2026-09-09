# Security

## Principle

**Every route must call the matching `backend/authz.js` guard before it
reads or writes.** Unlike the sibling gyftr-ceo-portal, there is no Postgres
Row-Level Security behind these routes as a safety net — see
[DATABASE.md](DATABASE.md). A route that forgets a check does not error,
does not fail obviously, and simply returns or writes data the caller should
never have touched. `frontend/src/roles.ts` mirrors these rules so the right
buttons render; it has no enforcement value of its own.

A useful way to read this document: for each control below, ask *"what
happens if someone skips the UI entirely and calls the API with a valid
token for the wrong person?"* That is the case each control is written for.

---

## Authentication

- AWS Cognito, email/password — real accounts with passwords, per the
  approved migration plan, not a passwordless profile picker.
- Every `/api` request carries a Cognito ID token, verified with
  `aws-jwt-verify` against the pool's public keys in `middleware/auth.js`
  *before* anything else happens (`app.use('/api', requireAuth, loadIdentity)`
  in `server.js`).
- New accounts are created in `FORCE_CHANGE_PASSWORD`. Cognito answers the
  first sign-in with a `NEW_PASSWORD_REQUIRED` challenge **instead of a
  session** — there is no token to reach the board with until the person
  sets their own password. This gate lives in the token issuer, not in
  application code that could forget to check a flag.
- `middleware/identity.js` links a Cognito identity to a `people` row by
  **verified** email on first sign-in only (`req.user.email_verified`
  must be true) — an unverified email claim is attacker-controllable and is
  never trusted to attach a session to someone else's row. If the matched
  row already has a different `cognito_sub`, the request is refused (403)
  rather than silently re-linked.
- There is **no auto-create** of a `people` row. A row carries a
  team/role/manager_id that drives real authorization decisions and must
  come from a real org source (the migration, `onboard.mjs`, or
  `create-person.mjs`) — not be invented for whoever happens to sign in first.
  Someone in the Cognito pool with no matching row gets a 403, not a default role.

---

## Authorization — the whole boundary is `backend/authz.js`

There is exactly one layer, and it is application code:

**`backend/authz.js`** — every function is a pure predicate (or throws),
taking the caller's `people` row (`req.profile`), and where relevant a
`projects` row (with `subtasks` nested) and the full `people` table. See its
header comment for the complete original-RLS-policy → JS-function mapping.
Every route in `backend/routes/` calls the matching guard **before** its
first `query()`/`withTransaction()` call.

| Guard | What it gates |
|---|---|
| `canSee(me, project, allPeople)` | Can `me` see this project at all? (GET /api/projects filters on this) |
| `canAct(me, project, allPeople)` | Is `me` in-court (or PMO, or subtree-owning under a coarse-team leak)? |
| `canCreateProject(me)` | POST /api/projects — PMO or business/product/tech_spoc |
| `enforceProjectUpdateScope(me, allPeople, old, patch)` | PATCH /api/projects/:id — throws `FORBIDDEN:`/... on any disallowed column change; see `projectScope.js` |
| `canCreateSubtask` / `canManageSubtask` / `canDeleteSubtask` | subtasks routes |
| `canAddAttachment` / `canDeleteAttachment` | attachments routes, including the upload + presigned-download paths |
| `canResolveComment` | pin/resolve a comment — in-court/PMO, or the comment's own author |
| `canInsertStageHistory` | whether a stage transition may write the ledger row |
| `canEditStageTarget` | only the team that owns a stage (or PMO) may set that stage's expected date |
| `isPmo(me)` | DELETE /api/projects/:id — PMO only |

**`backend/projectScope.js`** — `enforceProjectUpdateScope()` is the single
most load-bearing function in the app: it decides, per changed column, who
may make that specific change, including two carve-outs worth naming
explicitly because they are easy to get backwards:

- **Business may fully edit their own subtree's project, except the hold
  columns** (`on_hold`, `hold_reason`, `held_by_id`, `held_by_team`,
  `held_at`) — "Business can't hold" is enforced here, not by hiding a
  button.
- **A Product lead acting outside their own court may only touch
  `target_go_live` / `timeline_eta`** — every other guarded column is
  refused with a specific error message, even for a lead.

Both are asserted directly in [`tests/logic.test.mjs`](tests/logic.test.mjs).

**Impossible operations** — some things have no route at all, the same
"impossible by construction" idea an RLS-based sibling gets from omitting a
policy: there is no `PATCH /api/stage_history/:id` or `PATCH
/api/comments/:id` text edit — the history ledger and comment text are
insert-only by omission, not by a check that could be forgotten.

---

## The failure mode this design accepts, and how it's covered

Because there is no RLS, the ENTIRE security boundary is "did this route
call the right `authz.js` function before touching the database." A route
that calls `query()` directly with no guard still works, still returns data,
and would pass any purely functional test — while leaking a project across a
team boundary. This is the direct analog of gyftr-ceo-portal's `query()` vs
`withUser()` trap, one layer up the stack (there it's "did you switch
Postgres role"; here it's "did you call the guard function").

There is currently no equivalent of that sibling's `tests/routes.test.mjs`
static-analysis check in this codebase. **This is the one gap worth flagging
explicitly for whoever adds the next route**: review every new route by hand
against the guard table above, and consider adding a routes-test mirroring
the CEO Office portal's pattern if this app's route count grows enough to
make manual review unreliable.

`tests/logic.test.mjs` proves the **guard functions themselves** are
correct. It cannot prove every route calls them — that is a code-review
discipline, not something these tests can catch.

---

## Attachment security

- The S3 bucket (when configured — see `infra/aws-setup.md` §4) is
  **private**, Block Public Access on all four settings. There is no
  anonymous URL for any object.
- Reading a real-uploaded attachment requires a signed URL, valid 60
  seconds, minted only by `GET /api/attachments/:id/url` after it re-reads
  the attachment's owning project and calls `canSee()` — **the identical
  predicate that governs the project itself**. Attachment visibility cannot
  drift from project visibility, because it is the same function call, not a
  separately maintained rule.
- Link-only attachments (`url` set, `storage_key` null — every attachment in
  the original schema, and still a fully supported path) are just stored
  strings; they carry no access control of their own beyond `canSee()` on
  the project that owns the comment/attachment row.
- Upload and delete both re-check `canAddAttachment()` / `canDeleteAttachment()`
  before touching S3 or the database row.
- Server-side limits: `MAX_ATTACHMENT_BYTES` (25 MB, see `backend/s3.js`).

---

## Input validation and injection

- Every query in `backend/` uses **parameterised** placeholders (`$1`, `$2`, …).
- The few places a column list is assembled dynamically (`PATCH
  /api/projects/:id`, `PATCH /api/subtasks/:id`) build it from a **hard-coded
  allow-list** of column names (`ALL_GUARDED_COLUMNS` in `projectScope.js`,
  or the `allowed` array in `routes/subtasks.js`), never from arbitrary
  request keys — an unlisted key in the request body is silently ignored,
  not interpolated.
- React escapes all rendered text; there is no `dangerouslySetInnerHTML` in
  the frontend, so project titles/comments cannot inject markup.

---

## Transport and headers

CORS is an **explicit origin allow-list** built from `FRONTEND_URL` (plus
localhost dev ports when `NODE_ENV !== 'production'`) — never `*`, which
would in any case be invalid alongside `credentials: true`. See
`backend/server.js`'s `ALLOWED_ORIGINS`.

RDS connections use TLS in production (`NODE_ENV=production` — see
`backend/db.js`). ALB listeners should be HTTPS with ACM certificates (see
`infra/aws-setup.md` §7).

---

## Secrets

- `AWS_SECRET_NAME` (Secrets Manager) is the preferred path for database
  credentials in production — a password in a task definition is readable by
  anyone holding `ecs:DescribeTaskDefinition`. `DB_*` env vars are the local/
  dev fallback (see `backend/.env.example`).
- The three `VITE_*` frontend build values (`VITE_API_URL`,
  `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`) are **public by
  design** — an address and two identifiers, shipped in a file every visitor
  downloads. They grant nothing on their own.
- `scripts/roster.json` (real names + working email addresses) is gitignored
  — this repository is public. See `scripts/roster.example.json`.
- No secret has ever been committed to this repository's history as far as
  this migration verified — see [HANDOVER.md](HANDOVER.md) for the specific
  live Supabase/Vercel tokens that still need rotating regardless, since
  they predate this migration and were shared during earlier development.

---

## Verification

`node --test tests/*.test.mjs` — pure-function tests against
`backend/authz.js` and `backend/projectScope.js` directly, no database
needed. See [DATABASE.md](DATABASE.md)'s "Verification" section for why that
is sufficient confidence for this app's model in a way it wouldn't be for an
RLS-based one.

---

## Before real use

1. **Confirm S3 Block Public Access** is on for all four settings, if the
   attachments bucket is used — the presigned-URL check in
   `routes/attachments.js` is the *entire* protection on those bytes; a
   readable bucket makes it decorative.
2. **Confirm the Cognito app client has no client secret**, and that the
   pool's password policy matches what `scripts/lib.mjs`'s generated
   temporary passwords satisfy (8+ chars, upper, lower, number, symbol).
3. **Rotate the old Supabase/Vercel credentials** once decommissioned — see
   HANDOVER.md's checklist.
4. Consider an IP allow-list or WAF in front of the ALB; the login page is
   publicly reachable (it grants nothing on its own, but it is visible).
5. **Code-review discipline for new routes** — see "The failure mode this
   design accepts" above. There is no automated check that a new route calls
   the right guard; that is the one place this app's security model asks
   more of a reviewer than the RLS-based sibling does.
