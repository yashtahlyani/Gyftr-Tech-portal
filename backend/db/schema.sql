-- ══════════════════════════════════════════════════════════════
-- Gyftr Tech Portal — RDS Postgres schema (AWS build).
-- Same tables as the old supabase/schema.sql, minus everything that only
-- made sense inside Supabase: no auth.users FK, no RLS policies, no
-- auth.uid()-keyed helper functions. Authorization now lives entirely in
-- backend/authz.js — this schema only enforces structural/data integrity.
--
-- Applied automatically on every API boot (db.js's applySchema()) — every
-- statement below is written to be safely re-runnable, same convention as
-- the sibling gyftr-portal/gyftr-legal backends: deploying = restarting a
-- container, never a separate manual `psql -f` step.
-- ══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto; -- gen_random_uuid()

-- Postgres has no `create type ... if not exists`, so enum types need this
-- standard idiom to be safely re-runnable.
do $$ begin
  create type team_id as enum ('business','product','tech_spoc','development','design','qa','partner','leadership');
exception when duplicate_object then null; end $$;
do $$ begin
  create type role_id as enum ('member','lead','pmo','leadership');
exception when duplicate_object then null; end $$;
do $$ begin
  create type stage_id as enum ('intake','scoping','to_be_picked','development','qa','uat','pre_prod','live');
exception when duplicate_object then null; end $$;
do $$ begin
  create type priority as enum ('P0','P1','P2');
exception when duplicate_object then null; end $$;

-- ── Directory: links a Cognito user to a team + role ──
create table if not exists people (
  id          uuid primary key default gen_random_uuid(),
  cognito_sub text unique,           -- null until the user's first successful login
  name        text not null,
  email       text unique not null,
  team        team_id not null,
  role        role_id not null default 'member'
);

-- Which team owns the ball while a project sits in a given stage. Kept as a
-- plain SQL function (no auth.* dependency) — mirrored exactly in authz.js's
-- STAGE_OWNER so the app layer never needs a round trip just to know this.
create or replace function stage_owner(s stage_id) returns team_id language sql immutable as $$
  select case s
    when 'intake' then 'business' when 'scoping' then 'product'
    when 'to_be_picked' then 'tech_spoc' when 'development' then 'development'
    when 'qa' then 'qa' when 'uat' then 'product' when 'pre_prod' then 'development'
    else 'leadership' end::team_id;
$$;

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
  -- denormalised for authorization checks — maintained by the app layer
  -- (backend/projectScope.js) inside the same transaction as every write,
  -- same rows the old sync_project_scope()/sync_subtask_scope() triggers grew:
  owner_team         team_id not null default 'business',
  involved_teams     team_id[] not null default '{business}',
  stage_entered_at   timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  target_go_live     date,
  sacrosanct_go_live date,
  priority_month     text,
  timeline_eta       date,
  dev_effort_days    int,
  reason_for_delay   text,
  product_spoc_id    uuid references people(id),
  tech_lead_id       uuid references people(id),
  final_go_live      date
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
create index if not exists subtasks_assignee_id_idx on subtasks (assignee_id);

-- Expected date per pipeline stage ("expected pickup date", "expected
-- dev-done date", etc.) — one row per project per stage, so project details
-- show a full timeline instead of a single overall status.
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
  by_id uuid references people(id), at timestamptz not null default now()
);
create index if not exists attachments_project_id_idx on attachments (project_id);
