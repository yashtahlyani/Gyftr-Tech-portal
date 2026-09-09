# Gyftr Tech Portal — Project Flow

A Jira-lite **project status & handoff tracker** for the Gyftr / Vouchagram tech org.
Replaces the long PM Activity Excel with one source of truth that answers the two
questions the Excel can't: **whose court is the ball in, and how long has it been there.**

Built on **React 19 + Vite + TypeScript** (`frontend/`) and an **Express API on
AWS** (`backend/`) — RDS Postgres, Cognito auth, ECS Fargate, an optional S3
attachments bucket. Formerly Supabase + Vercel; see [CHANGELOG.md](CHANGELOG.md)
for the migration and [HANDOVER.md](HANDOVER.md) for what's provisioned vs
what still needs real AWS access.

## The model

A project flows through nine owned stages:

```
Intake → Scoping → To Be Picked → Development → PM Review → QA → UAT → Pre-Prod → Live
(Business) (Product)  (Tech SPOC)   (Dev/Design)  (Product) (QA) (Product) (Dev)  (Leadership)
```

- **Every project always has exactly one owning team** (the ball holder). Handoffs are
  timestamped in `stage_history` — that ledger is what ends the blame game.
- **Statuses** (Scoping, In Dev, UAT, Blocked, On Hold, Live, …) map to the app's
  workflow schema (`frontend/src/workflow.ts`).
- **Hierarchy-aware visibility** — a manager sees their whole reporting subtree's
  work, not just their own team's, via `manager_id`-derived subtree checks (see
  [DATABASE.md](DATABASE.md) and `backend/authz.js`).
- **Leadership View** — KPIs, pipeline distribution, "whose court" split, and an
  ageing watchlist.

## Run it locally

```bash
npm run install:all          # frontend + backend + scripts
cp backend/.env.example backend/.env      # fill in DB / Cognito values
cp .env.example .env                       # for docker-compose and scripts/

npm run docker:up            # frontend :8979, backend :8978, postgres :5443
# — or, running each piece by hand against your own Postgres —
npm run dev:backend          # backend :8978
npm run dev:frontend         # frontend dev server
```

See [DEPLOY.md](DEPLOY.md) for the full local/dev/production runbook, and
[DEMO.md](DEMO.md) for seeding demo data and a walkthrough.

## Architecture

- `backend/workflow.js` (server) / `frontend/src/workflow.ts` (client) — the
  state machine: stages, statuses, SLAs, legal transitions.
- `backend/authz.js` — **the** authorization boundary. This app enforces
  permissions in Express middleware, not Postgres Row-Level Security — see
  [DATABASE.md](DATABASE.md)'s "Authorization" section, which explains this
  explicitly because the sibling CEO Office portal does the opposite.
- `backend/projectScope.js` — the two former Postgres triggers
  (`sync_project_scope` / `enforce_project_update_scope`) as plain JS,
  invoked inside a transaction on every project write.
- `backend/routes/*.js` — one file per resource, each behind `requireAuth` +
  `loadIdentity`.
- `frontend/src/store.ts` — dispatcher; `cloudStore.ts` calls the Express API
  with a Cognito ID token attached.
- [`backend/sql/01_schema.sql`](backend/sql/01_schema.sql) — the full RDS
  schema: tables, enums, indexes. Plain DDL only — no policies, no
  SECURITY DEFINER functions.

Full detail: [ARCHITECTURE.md](ARCHITECTURE.md).

## Repository map

```
backend/    Express API — server.js, db.js, authz.js, projectScope.js,
            routes/, middleware/, sql/
frontend/   React 19 + Vite + TypeScript SPA
scripts/    Admin scripts (direct DB + Cognito access): onboard, seed,
            doctor, force-password-reset, and the one-time
            Supabase → RDS migration (scripts/aws-migration/)
infra/      First-time AWS provisioning runbook + the one DBA-only SQL step
tests/      node:test unit tests for backend/authz.js + projectScope.js
supabase/   The ORIGINAL Supabase schema — kept as migration reference only,
            not touched, not deployed. Do not add to it.
```

## Docs

| Question | File |
|---|---|
| How does it work internally? | [ARCHITECTURE.md](ARCHITECTURE.md) |
| What is the data model, and how is it different from the CEO Office portal? | [DATABASE.md](DATABASE.md) |
| How is access actually enforced? | [SECURITY.md](SECURITY.md) |
| How do I demo it? | [DEMO.md](DEMO.md) |
| How do I deploy / provision AWS? | [DEPLOY.md](DEPLOY.md), [infra/aws-setup.md](infra/aws-setup.md) |
| What's built vs what needs real AWS access? | [HANDOVER.md](HANDOVER.md) |
| Why was it built this way? | [PROJECT_PLAN.md](PROJECT_PLAN.md) |
| What changed recently? | [CHANGELOG.md](CHANGELOG.md) |

## Roadmap

- **Shipped:** hierarchy/subtree visibility, hold workflow, PM review stage,
  sub-tasks with assignees, flow board, role-scoped views, leadership
  dashboard, escalations, priority notes, the AWS migration (this repo state).
- **Phase 2:** SLA breach alerts, real-file attachment uploads to S3 (backend
  support exists — see `backend/s3.js`; wire up the frontend), a ~7s poll in
  place of the old Supabase Realtime subscription (documented trade-off, see
  [ARCHITECTURE.md](ARCHITECTURE.md)).
