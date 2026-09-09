-- ═══════════════════════════════════════════════════════════
-- Gyftr Tech Portal — RDS Postgres Schema (AWS migration)
-- Migration 01 of 1 — see backend/sql/'s own layout note below.
--
-- Plain Postgres — no Supabase-specific features:
--   - No `auth.users` FK (Cognito is external to the DB)
--   - No Row Level Security / SECURITY DEFINER functions — every check that
--     used to live in a Postgres policy now lives in the Express backend
--     (see backend/authz.js's audit-comment header for the full mapping,
--     and backend/projectScope.js for the two trigger functions).
--   - `people.cognito_sub` replaces the old `people.auth_id -> auth.users.id`
--
-- ── Why this directory is numbered migrations, but only has one file ──
-- Mirrors gyftr-ceo-portal/backend/sql/'s layout (00_compat.sql,
-- 01_schema.sql, 02_functions.sql, 03_policies.sql, ...05_/06_/07_ change
-- requests, 08_grants.sql) applied in filename order by db.js's
-- applyMigrations() — see that file's comment on why order matters and why
-- each file runs as one transaction. That sibling's later-numbered files
-- exist because it enforces authorization with real Postgres Row-Level
-- Security (a Postgres `role`, ~19 `create policy` statements, and a grants
-- pass only an RDS master/DBA can run — see its infra/dba-setup.sql).
--
-- This app deliberately does NOT use RLS (see the migration plan / this
-- header's first bullet) — authorization is Express middleware (authz.js),
-- following the gyftr-legal convention instead. So there is no
-- 00_compat.sql (defines auth.uid()/the `authenticated` role — nothing here
-- needs either), no 03_policies.sql, and no 08_grants.sql (no DBA-only
-- ownership/grants step — the app's own DB user can run this file
-- directly, no infra/dba-setup.sql required). Future schema changes should
-- still land as NEW numbered files here (02_..., 03_..., ...) rather than
-- edited into this one, once this has shipped to a real database — the
-- numbering convention is worth keeping even though today it's a single
-- file, so the next change follows the same pattern this was copied from.
--
-- Idempotent by design (every statement is IF NOT EXISTS / OR REPLACE, or a
-- do-block that swallows duplicate_object) so backend/db.js can apply it on
-- every boot — deploying is just a restart, nobody has to remember to
-- hand-run psql. Also safe to run once against a fresh RDS database before
-- scripts/aws-migration/migrate-db.mjs.
--
-- No CREATE EXTENSION here: the app DB user is not a superuser, and
-- gen_random_uuid() is built into Postgres 13+ (no uuid-ossp/pgcrypto needed).
-- ═══════════════════════════════════════════════════════════

do $$ begin
  create type team_id as enum ('business','product','tech_spoc','development','design','qa','partner','leadership');
exception when duplicate_object then null; end $$;

do $$ begin
  create type role_id as enum ('member','lead','pmo','leadership','svp');
exception when duplicate_object then null; end $$;

-- 'pm_review' sits between development and qa — Development -> Send to
-- Project Manager -> QA. This enum's declared order IS pipeline order
-- everywhere else (stage_targets sequencing, workflow.ts's STAGE_ORDER).
do $$ begin
  create type stage_id as enum ('intake','scoping','to_be_picked','development','pm_review','qa','uat','pre_prod','live');
exception when duplicate_object then null; end $$;

do $$ begin
  create type priority as enum ('P0','P1','P2');
exception when duplicate_object then null; end $$;

-- ── Directory: links a Cognito identity to a team + role ──
create table if not exists people (
  id          uuid primary key default gen_random_uuid(),
  cognito_sub text unique,      -- filled in by scripts/aws-migration/create-cognito-users.mjs
                                 -- or auto-linked on first login by middleware/loadProfile.js
  name        text not null,
  email       text unique not null,
  team        team_id not null,
  role        role_id not null default 'member',
  -- Org reporting chain — self-referencing, any depth. Null for anyone who
  -- isn't part of a managed hierarchy, and for anyone at the root of one.
  -- Drives subtree-based project visibility (see authz.js's orgSubtreeIds).
  manager_id  uuid references people(id),
  -- Real-world department/function (E-Pay, Infra, Testing, etc.) — purely
  -- descriptive, shown in the UI. NOT used for authorization; that's `team`.
  department  text,
  -- Explicit, named "sees every project" grant — data-driven, not a
  -- hierarchy derivation. Visibility only; doesn't imply write access.
  sees_all_projects boolean not null default false,
  -- false = retired from the directory. Row stays for FK/history integrity
  -- but must never appear as an assignment/owner candidate (client-side rule).
  active      boolean not null default true
);
create index if not exists people_cognito_sub_idx on people (cognito_sub);
create index if not exists people_manager_id_idx on people (manager_id);

create sequence if not exists projects_code_seq;

create table if not exists projects (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique not null default ('TP-' || lpad(nextval('projects_code_seq')::text, 3, '0')),
  title              text not null,
  brd                text default '',
  partner            text not null,
  brand              text,
  lob                text,
  priority           priority not null default 'P1',
  bifurcation        text check (bifurcation in ('B2B','B2C')) default 'B2C',
  stage              stage_id not null default 'intake',
  status             text not null,
  owner_id           uuid references people(id),
  business_owner_id  uuid references people(id),
  blocked            boolean not null default false,
  block_reason       text,
  -- "Mark as Hold" — an explicit pause, separate from blocked/block_reason.
  -- Doesn't touch stage/status at all; un-holding just clears these five.
  on_hold            boolean not null default false,
  hold_reason        text,
  held_by_id         uuid references people(id),
  held_by_team       team_id,
  held_at            timestamptz,
  -- denormalised for authorization — maintained by projectScope.js on every write:
  owner_team         team_id not null default 'business',
  involved_teams     team_id[] not null default '{business}',
  stage_entered_at   timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  target_go_live     date,
  sacrosanct_go_live date,
  -- PM Activity List sheet parity:
  priority_month     text,
  timeline_eta       date,
  dev_effort_days    int,
  reason_for_delay   text,
  product_spoc_id    uuid references people(id),
  tech_lead_id       uuid references people(id),
  final_go_live      date  -- stamped automatically by projectScope.js on going live
);
create index if not exists projects_stage_idx on projects (stage);
create index if not exists projects_involved_teams_idx on projects using gin (involved_teams);

create table if not exists subtasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text not null, team team_id not null, assignee_id uuid references people(id),
  done boolean not null default false, created_at timestamptz not null default now(),
  expected_date date,   -- set by the assigner: when they need it done by
  promised_date date,   -- set by the assignee: their own committed date
  effort_days   int     -- set by the assignee: estimated effort
);
create index if not exists subtasks_project_id_idx on subtasks (project_id);

-- Expected date per pipeline stage ("expected pickup date", "expected
-- dev-done date", etc.) — one row per project per stage.
create table if not exists stage_targets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stage stage_id not null,
  expected_date date,
  updated_by uuid references people(id),
  updated_at timestamptz not null default now(),
  unique (project_id, stage)
);

create table if not exists stage_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  at timestamptz not null default now(), by_id uuid references people(id),
  from_stage stage_id, to_stage stage_id not null,
  from_status text, to_status text not null, note text
);
create index if not exists stage_history_project_id_idx on stage_history (project_id);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  at timestamptz not null default now(), by_id uuid references people(id),
  text text not null, pinned boolean not null default false, resolved boolean not null default false
);
create index if not exists comments_project_id_idx on comments (project_id);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  name text not null, kind text not null, url text,
  -- S3 object key for an actually-uploaded file (backend/s3.js) — additive,
  -- not in supabase/schema.sql: every attachment there was a caller-supplied
  -- `url` (a pasted Doc/Figma/SharePoint link), never a real upload. Null for
  -- link-only attachments; when set, routes/attachments.js presigns a fresh
  -- GET url on read instead of trusting a stored one.
  storage_key text,
  by_id uuid references people(id), at timestamptz not null default now()
);
create index if not exists attachments_project_id_idx on attachments (project_id);

-- Phase 2 hook (kept for parity with supabase/schema.sql's own note): a
-- scheduled job could scan stage_entered_at vs an SLA table and notify the
-- current owner + PMO on breach; a trigger-equivalent on `comments` where
-- pinned = true could notify the owning team of a leadership priority note.
-- Neither is implemented — same as the source schema.
