# Architecture

```
Browser (React 19 + Vite)
   │  a Cognito ID token — no other credential exists client-side
   ▼
Express API (ECS Fargate, arm64)
   ├── requireAuth ....... verifies the token signature (aws-jwt-verify)
   ├── loadIdentity ...... resolves `sub` → a people row (auto-links by
   │                       verified email on first login)
   └── authz.js .......... EVERY route calls the matching guard before
        │                  reading/writing — see SECURITY.md
        ▼
   RDS Postgres  ← plain DDL only, no RLS, no SECURITY DEFINER functions
   └── db.js applies backend/sql/*.sql idempotently on every boot

   S3 (private, optional) ... attachment bytes, 60-second presigned URLs
   Cognito .................. accounts, first-login password challenge
```

**The client is a rendering layer with no authority.** So, in a different way
than the CEO Office sibling, is the database: Postgres here enforces nothing
beyond foreign keys and column constraints. Every access decision is made in
`backend/authz.js`, which every route calls before it reads or writes
anything. See [DATABASE.md](DATABASE.md) for why this app made that choice
instead of Row-Level Security, and [SECURITY.md](SECURITY.md) for the guard
inventory.

---

## Backend (`backend/`)

```
server.js          Express app, CORS allowlist, /health vs /health/deep,
                    mounts every router behind requireAuth + loadIdentity
db.js               RDS connection pool, retry-loop init, applies
                    sql/*.sql idempotently on every boot, withTransaction()
authz.js            THE authorization boundary — every RLS policy /
                    SECURITY DEFINER function from supabase/schema.sql,
                    ported 1:1 to plain JS. See its own header for the full
                    policy-name -> function-name mapping.
projectScope.js     The two former triggers (sync_project_scope,
                    enforce_project_update_scope) plus
                    enforce_stage_target_order and sync_subtask_scope, as
                    plain functions invoked inside a transaction
workflow.js         Server-side slice of the pipeline model: which team
                    owns which stage (stageOwner), and pipeline order
                    (STAGE_ORDER) — just what authz.js/projectScope.js need
serialize.js        Shared SELECT shapes (nested project JSON, all-people
                    fetch) reused across routes
s3.js               Attachment upload / presigned download / delete —
                    additive over the original link-only attachments column
errors.js           HttpError + handle() — maps FORBIDDEN:/NOT_FOUND:/
                    INVALID:-tagged thrown Errors to HTTP status codes
middleware/
  auth.js            Verifies the Cognito JWT (aws-jwt-verify)
  identity.js        Resolves req.user.sub -> req.profile (a people row),
                      auto-linking by verified email on first login
routes/
  people.js          GET /api/people — the whole directory, any authenticated caller
  projects.js        GET/POST /api/projects, PATCH/DELETE /api/projects/:id
  subtasks.js        POST .../subtasks, PATCH/DELETE /api/subtasks/:id
  comments.js        POST/PATCH on a project's comments
  attachments.js      link + real-upload attachments, presigned download
  stageTargets.js     per-stage expected-date targets
sql/
  01_schema.sql        plain DDL: tables, enums, indexes. See its own
                        header for why the migrations/ directory is
                        numbered but currently holds only one file.
```

### Where business logic lives

Every rule that used to live in a Postgres policy or SECURITY DEFINER
function now lives in `authz.js` or `projectScope.js`, called explicitly at
the top of the route handler that needs it. There is no second copy anywhere
in the backend — `frontend/src/roles.ts` is the UI-only mirror (buttons and
visibility hints), and if the two ever disagree, `authz.js` is correct and
the frontend is the bug.

The single most important consequence for anyone adding a route: **calling
`query()` instead of going through the right `authz.js` guard first does not
error, does not fail a functional test, and quietly returns or writes data
the caller should never have touched.** There is no RLS safety net behind a
route that forgets — see [SECURITY.md](SECURITY.md).

### `PATCH /api/projects/:id` — the one endpoint behind every mutation

Every UI action that used to fire a raw Supabase `.update()` (transition,
reassign, pick up, block/unblock, set hold, edit planning details) is one
guarded `PATCH`. Inside a `db.js` transaction:

1. Lock the row (`for update`), load its subtasks.
2. `enforceProjectUpdateScope(me, allPeople, oldProject, patch)` — throws if
   the actor may not touch the fields being changed (see `projectScope.js`).
3. If `stage` is part of the patch, `syncProjectScope()` recomputes
   `owner_team`/`involved_teams`/`final_go_live`.
4. Write the row, and — if the stage/status changed or a note was given —
   insert a `stage_history` row, atomically, in the same transaction.

This is what used to be one Postgres UPDATE plus a fire-and-forget
`stage_history` INSERT from the client; making it one transaction removed a
real race condition the old Supabase design had.

---

## Frontend (`frontend/`)

```
src/
  main.tsx / App.tsx    entry + shell: nav, role-scoped views, toasts
  workflow.ts            client copy of the stage/status/transition model
  roles.ts                client-side permission MIRROR of backend/authz.js
                           — UI hints only, no enforcement value
  store.ts                dispatcher; cloudStore.ts calls the Express API
  cloudStore.ts            fetch wrapper attaching the Cognito ID token,
                           ~7s poll in place of the old Supabase Realtime
                           subscription (see "Not built" below)
  auth.ts                  amazon-cognito-identity-js: sign-in, forced
                           first-login password change
  api.ts                   thin fetch wrapper against VITE_API_URL
  views/                   Login, MyQueue, Board, TableView, Dashboard,
                           Escalations, Drawer, CreateModal, FilterBar
```

### Auth

Real Cognito accounts with passwords — a shared temporary password + forced
reset on first login for the initial org migration
(`scripts/aws-migration/create-cognito-users.mjs`), or per-person invites
going forward (`scripts/onboard.mjs`, `scripts/create-person.mjs`) — matching
the sibling portals, not a passwordless profile picker. A new account is
created in `FORCE_CHANGE_PASSWORD`, so Cognito answers the first sign-in with
a `NEW_PASSWORD_REQUIRED` challenge instead of a session: there is no token
to reach the board with until the password is set.

`people.cognito_sub` links an account to a person. `middleware/identity.js`
establishes that link on first sign-in, matching by **verified** email only
— an unverified email claim is attacker-controllable and is never trusted to
attach a session to someone else's row. There is deliberately no
auto-create: a `people` row carries a team/role/reporting position that
drives real authorization decisions, and must come from a real org source
(the migration, or an admin script), not be invented for whoever signs in
first.

---

## Storage (optional)

Bucket for project attachments, private, Block Public Access on all four
settings. Every attachment in the original schema was a caller-supplied link
(Doc/Figma/SharePoint URL) — this is additive, for teams that want to upload
an actual file. Objects are named `project/<project_id>/<uuid>-<filename>`.

Reading requires a signed URL, minted only after `backend/routes/
attachments.js` re-checks `canSee()`/`canAddAttachment()` against the owning
project — the same functions that gate everything else about that project.
There is no public URL for any object.

---

## Not built (deliberate)

**Realtime.** The original Supabase build subscribed to Postgres Realtime on
every table. AWS has no drop-in equivalent without extra infrastructure
(AppSync, a WebSocket API Gateway + Lambda fan-out, etc.), so the frontend
polls every ~7 seconds instead — documented trade-off, not an oversight. If
live updates become a real requirement, the natural seam is a change-data-
capture stream off RDS feeding a small pub/sub layer.

**Real Postgres RLS.** See [DATABASE.md](DATABASE.md) — a deliberate,
documented choice to follow the gyftr-legal convention (Express-middleware
authorization) rather than the gyftr-ceo-portal convention (RLS), because
this app's authorization was already fully specified as ported RLS policies
and porting the *policies* to JS functions was lower-risk than re-deriving
the rules from scratch as RLS.

**SLA breach notifications.** A scheduled job comparing `stage_entered_at`
against a per-stage day budget, and pinned unresolved comments, is the
natural Phase 2 (same note the original Supabase-era `supabase/schema.sql`
carried).
