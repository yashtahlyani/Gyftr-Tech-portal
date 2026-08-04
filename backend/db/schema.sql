-- ══════════════════════════════════════════════════════════════
-- Gyftr Tech Portal — RDS Postgres schema (AWS build).
-- Same tables as the old supabase/schema.sql, minus everything that only
-- made sense inside Supabase: no auth.users FK, no RLS policies, no
-- auth.uid()-keyed helper functions. Authorization now lives entirely in
-- backend/authz.js — this schema only enforces structural/data integrity.
-- Run once against a fresh RDS database.
-- ══════════════════════════════════════════════════════════════

create type team_id  as enum ('business','product','tech_spoc','development','design','qa','partner','leadership');
create type role_id  as enum ('member','lead','pmo','leadership');
create type stage_id as enum ('intake','scoping','to_be_picked','development','qa','uat','pre_prod','live');
create type priority as enum ('P0','P1','P2');

-- ── Directory: links a Cognito user to a team + role ──
create table people (
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

create sequence projects_code_seq;

create table projects (
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
create index on projects (stage);
create index on projects using gin (involved_teams);

create table subtasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text not null, team team_id not null, assignee_id uuid references people(id),
  done boolean not null default false, created_at timestamptz not null default now(),
  expected_date date,
  promised_date date,
  effort_days   int
);

create table stage_targets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stage stage_id not null,
  expected_date date,
  updated_by uuid references people(id),
  updated_at timestamptz not null default now(),
  unique (project_id, stage)
);

create table stage_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  at timestamptz not null default now(), by_id uuid references people(id),
  from_stage stage_id, to_stage stage_id not null,
  from_status text, to_status text not null, note text
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  at timestamptz not null default now(), by_id uuid references people(id),
  text text not null, pinned boolean not null default false, resolved boolean not null default false
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  name text not null, kind text not null, url text,
  by_id uuid references people(id), at timestamptz not null default now()
);

create extension if not exists pgcrypto; -- gen_random_uuid()
