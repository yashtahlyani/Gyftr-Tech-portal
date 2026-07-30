-- ══════════════════════════════════════════════════════════════
-- Gyftr Tech Portal — Postgres schema + REAL row-level security
-- The DB enforces the same rules the app does, so nothing leaks even
-- if a client is compromised. Run in the Supabase SQL editor.
-- ══════════════════════════════════════════════════════════════

create type team_id  as enum ('business','product','tech_spoc','development','design','qa','partner','leadership');
create type role_id  as enum ('member','lead','pmo','leadership');
create type stage_id as enum ('intake','scoping','to_be_picked','development','qa','uat','pre_prod','live');
create type priority as enum ('P0','P1','P2');

-- ── Directory: links a Supabase Auth user to a team + role ──
create table people (
  id      uuid primary key default gen_random_uuid(),
  auth_id uuid unique references auth.users(id) on delete cascade,
  name    text not null,
  email   text unique not null,
  team    team_id not null,
  role    role_id not null default 'member'
);

-- ── Identity helpers (SECURITY DEFINER so RLS policies can call them) ──
create or replace function my_team() returns team_id language sql stable security definer as $$
  select team from people where auth_id = auth.uid();
$$;
create or replace function my_role() returns role_id language sql stable security definer as $$
  select role from people where auth_id = auth.uid();
$$;
create or replace function is_overseer() returns boolean language sql stable security definer as $$
  select coalesce(my_role() in ('pmo','leadership'), false);
$$;
create or replace function is_pmo() returns boolean language sql stable security definer as $$
  select coalesce(my_role() = 'pmo', false);
$$;

-- Which team owns the ball while a project sits in a given stage.
-- UAT is owned by Product (not Business) — go-live/deploy approval sits with
-- Product per the CEO's process, matching TRANSITIONS.qa's forward in workflow.ts.
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
  -- denormalised for RLS — maintained by trigger below:
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
  final_go_live      date  -- stamped automatically by trg_scope on going live
);
create index on projects (stage);
create index on projects using gin (involved_teams);

-- Keep owner_team + involved_teams correct on every write → RLS stays accurate.
-- Folds in my_team() (the acting user's own team), not just the new owner:
-- without it, e.g. Product creating a project on Business's behalf sets
-- involved_teams to {business} only, and the creator can't even SELECT the
-- row they just inserted back (RETURNING is itself subject to the SELECT
-- policy) — Postgres reports that identically to a WITH CHECK failure.
create or replace function sync_project_scope() returns trigger language plpgsql as $$
begin
  new.owner_team := stage_owner(new.stage);
  -- Final go-live stamps itself the moment a project reaches Live.
  if new.stage = 'live' and new.final_go_live is null then
    new.final_go_live := current_date;
  end if;
  new.involved_teams := (
    select array(select distinct unnest(
      coalesce(old.involved_teams, array['business']::team_id[])
      || new.owner_team || 'business'::team_id || coalesce(my_team(), new.owner_team)))
  );
  return new;
end;
$$;
create trigger trg_scope before insert or update of stage on projects
  for each row execute function sync_project_scope();

create table subtasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text not null, team team_id not null, assignee_id uuid references people(id),
  done boolean not null default false, created_at timestamptz not null default now(),
  expected_date date,   -- set by the assigner: when they need it done by
  promised_date date,   -- set by the assignee: their own committed date
  effort_days   int     -- set by the assignee: estimated effort
);

-- Assigning a sub-task to a team makes the project visible to that team
-- (e.g. a Design sub-task on a Dev-stage project lets Design see it at all).
-- SECURITY DEFINER so the scope-sync write itself never trips projects RLS.
create or replace function sync_subtask_scope() returns trigger language plpgsql security definer as $$
begin
  update projects
     set involved_teams = (select array(select distinct unnest(involved_teams || new.team)))
   where id = new.project_id and not (new.team = any(involved_teams));
  return new;
end;
$$;
create trigger trg_subtask_scope after insert or update of team on subtasks
  for each row execute function sync_subtask_scope();

-- Expected date per pipeline stage ("expected pickup date", "expected
-- dev-done date", etc.) — one row per project per stage, so project details
-- show a full timeline instead of a single overall status.
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

-- Can the current user SEE this project? (their team is involved, or they oversee)
create or replace function can_see(pid uuid) returns boolean language sql stable security definer as $$
  select is_overseer() or exists (
    select 1 from projects p where p.id = pid and my_team() = any(p.involved_teams)
  );
$$;
-- Can they ACT on it? (their team currently holds the ball, or PMO)
create or replace function can_act(pid uuid) returns boolean language sql stable security definer as $$
  select is_pmo() or exists (
    select 1 from projects p where p.id = pid and my_team() = p.owner_team
  );
$$;

-- ── RLS ──
alter table projects      enable row level security;
alter table subtasks      enable row level security;
alter table stage_history enable row level security;
alter table comments      enable row level security;
alter table attachments   enable row level security;
alter table stage_targets enable row level security;

-- projects: see if involved/overseer; create if business/product/spoc/pmo; update only in-court team or pmo
--
-- p_upd's WITH CHECK deliberately checks involved_teams, not "my_team() = the new owner":
-- a handoff (forward/back/reject) is written by the OUTGOING team, and after
-- sync_project_scope() recomputes owner_team to the INCOMING team, my_team() = owner_team
-- would never hold for the very update that performs the handoff. involved_teams only
-- grows, and the actor's team is already in it (added the moment they became owner), so
-- this still rejects teams that were never part of the project while allowing every
-- legitimate transition.
--
-- Product leads are also let in on ANY project (not just their own court) so they can
-- renegotiate go-live dates with a partner without waiting on whichever team holds the
-- ball — RLS only decides row reachability here; enforce_project_update_scope() below
-- is what actually restricts them to touching just the date columns.
create policy p_sel on projects for select using ( is_overseer() or my_team() = any(involved_teams) );
create policy p_ins on projects for insert with check ( is_pmo() or my_team() in ('business','product','tech_spoc') );
create policy p_upd on projects for update
  using (
    is_pmo() or my_team() = owner_team or (stage = 'to_be_picked' and my_team() = 'development')
    or (my_role() = 'lead' and my_team() = 'product')
  )
  with check (
    is_pmo() or my_team() = any(involved_teams)
    or (my_role() = 'lead' and my_team() = 'product')
  );
create policy p_del on projects for delete using ( is_pmo() );

-- Column-level guard for the product-lead-anywhere case above: everyone who
-- reaches this point via the normal in-court/pmo path is waved through
-- untouched; a product lead acting outside their own court may change go-live
-- dates and nothing else. auth.uid() is null for admin/service connections
-- (Management API, SQL editor, migrations) — those always bypass, same as
-- superusers bypass RLS; this is a plain trigger, so it needs its own escape
-- hatch or it would block legitimate admin fixes too.
create or replace function enforce_project_update_scope() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  -- Pure visibility bookkeeping (sync_subtask_scope's cascading UPDATE when a
  -- sub-task adds a new team to involved_teams, or any future trigger that
  -- only touches that column) must never be blocked here — it's not a user
  -- edit. Without this, e.g. Tech SPOC creating a sub-task on a Product-court
  -- project fails: the SECURITY DEFINER trigger's own UPDATE still runs as
  -- the calling user for auth.uid()/my_team() purposes, and Tech SPOC isn't
  -- yet in involved_teams at that point, so every check below would reject it.
  if new.title is not distinct from old.title
    and new.brd is not distinct from old.brd
    and new.partner is not distinct from old.partner
    and new.brand is not distinct from old.brand
    and new.lob is not distinct from old.lob
    and new.priority is not distinct from old.priority
    and new.bifurcation is not distinct from old.bifurcation
    and new.stage is not distinct from old.stage
    and new.status is not distinct from old.status
    and new.owner_id is not distinct from old.owner_id
    and new.business_owner_id is not distinct from old.business_owner_id
    and new.blocked is not distinct from old.blocked
    and new.block_reason is not distinct from old.block_reason
    and new.priority_month is not distinct from old.priority_month
    and new.dev_effort_days is not distinct from old.dev_effort_days
    and new.reason_for_delay is not distinct from old.reason_for_delay
    and new.product_spoc_id is not distinct from old.product_spoc_id
    and new.tech_lead_id is not distinct from old.tech_lead_id
    and new.sacrosanct_go_live is not distinct from old.sacrosanct_go_live
    and new.target_go_live is not distinct from old.target_go_live
    and new.timeline_eta is not distinct from old.timeline_eta
  then
    return new;
  end if;
  if is_pmo() or my_team() = old.owner_team or (old.stage = 'to_be_picked' and my_team() = 'development') then
    return new;
  end if;
  if my_role() = 'lead' and my_team() = 'product' then
    if new.title is distinct from old.title
      or new.brd is distinct from old.brd
      or new.partner is distinct from old.partner
      or new.brand is distinct from old.brand
      or new.lob is distinct from old.lob
      or new.priority is distinct from old.priority
      or new.bifurcation is distinct from old.bifurcation
      or new.stage is distinct from old.stage
      or new.status is distinct from old.status
      or new.owner_id is distinct from old.owner_id
      or new.business_owner_id is distinct from old.business_owner_id
      or new.blocked is distinct from old.blocked
      or new.block_reason is distinct from old.block_reason
      or new.priority_month is distinct from old.priority_month
      or new.dev_effort_days is distinct from old.dev_effort_days
      or new.reason_for_delay is distinct from old.reason_for_delay
      or new.product_spoc_id is distinct from old.product_spoc_id
      or new.tech_lead_id is distinct from old.tech_lead_id
      or new.sacrosanct_go_live is distinct from old.sacrosanct_go_live
    then
      raise exception 'Product leads may only edit go-live dates (Expected / Timeline ETA) outside their own court';
    end if;
    return new;
  end if;
  raise exception 'insufficient_privilege';
end;
$$;
create trigger trg_enforce_update before update on projects
  for each row execute function enforce_project_update_scope();

-- children: readable if the project is visible.
-- Sub-tasks: creation is restricted to Product + Tech SPOC (they scope the
-- work); everyone can still view; update/delete open to the in-court team,
-- PMO, or (own row only) the assignee filling in their own promised date/effort.
create policy s_sel on subtasks for select using ( can_see(project_id) );
create policy s_ins on subtasks for insert with check ( is_pmo() or my_team() in ('product', 'tech_spoc') );
-- Managing a sub-task (reassign/edit/delete) is Product + Tech SPOC + PMO
-- only — same authority as creating one, NOT "whoever's team holds court".
-- The assignee always keeps the ability to toggle/update their own item.
create policy s_upd on subtasks for update
  using ( is_pmo() or my_team() in ('product','tech_spoc') or assignee_id = (select id from people where auth_id = auth.uid()) )
  with check ( is_pmo() or my_team() in ('product','tech_spoc') or assignee_id = (select id from people where auth_id = auth.uid()) );
create policy s_del on subtasks for delete using ( is_pmo() or my_team() in ('product','tech_spoc') );

-- Stage targets: only the team that OWNS a given stage may set/update that
-- stage's expected date (not any involved team — Business doesn't get to set
-- QA's date). PMO can always act.
create policy st_sel on stage_targets for select using ( can_see(project_id) );
create policy st_wr  on stage_targets for all
  using ( is_pmo() or my_team() = stage_owner(stage) )
  with check ( is_pmo() or my_team() = stage_owner(stage) );

-- Dates fill in sequentially, stage by stage, in pipeline order — never out
-- of order. stage_id's declared enum order IS the pipeline order (intake <
-- scoping < ... < live), so stages compare directly with < .
-- SECURITY DEFINER: without it, this function's own lookups run as the
-- calling user and are themselves subject to st_sel/can_see RLS — e.g.
-- Product setting Scoping's date can't see Business's already-set Intake
-- date (Product isn't in involved_teams until the project reaches Scoping),
-- so the "is the previous stage already set" check would incorrectly say no.
create or replace function enforce_stage_target_order() returns trigger language plpgsql security definer as $$
declare
  missing_stage stage_id;
  max_prev_date date;
begin
  if new.expected_date is null then
    return new; -- clearing a date is always allowed
  end if;
  select s into missing_stage
    from unnest(enum_range(null::stage_id)) as s
   where s < new.stage
     and s not in (
       select stage from stage_targets
        where project_id = new.project_id and stage != new.stage and expected_date is not null
     )
   limit 1;
  if missing_stage is not null then
    raise exception 'Set % expected date before %', missing_stage, new.stage;
  end if;

  select max(expected_date) into max_prev_date
    from stage_targets
   where project_id = new.project_id and stage < new.stage;
  if max_prev_date is not null and new.expected_date < max_prev_date then
    raise exception 'Expected date must be on or after the previous stage''s date (%)', max_prev_date;
  end if;

  return new;
end;
$$;
create trigger trg_stage_target_order before insert or update of expected_date on stage_targets
  for each row execute function enforce_stage_target_order();

create policy h_sel on stage_history for select using ( can_see(project_id) );
-- NOT can_act(project_id): a transition fires the projects UPDATE and this
-- history INSERT as two independent, un-awaited requests (see transition() in
-- cloudStore.ts). can_act() reads the CURRENT owner_team, which flips to the
-- RECEIVING team the instant the projects UPDATE commits — so if that commits
-- first, the outgoing team's own history entry for the handoff they just made
-- gets rejected by RLS. involved_teams only ever grows and already contained
-- the outgoing team before they acted, so it's race-proof.
create policy h_ins on stage_history for insert with check (
  is_pmo() or exists ( select 1 from projects p where p.id = project_id and my_team() = any(p.involved_teams) )
);

-- comments: anyone who can SEE the project may comment (incl. leadership); only in-court/pmo can resolve
create policy c_sel on comments for select using ( can_see(project_id) );
create policy c_ins on comments for insert with check ( can_see(project_id) );
create policy c_upd on comments for update using ( can_act(project_id) or by_id = (select id from people where auth_id = auth.uid()) );

-- attachments: involved teams (not pure observers) can add; anyone who sees the project can read
create policy a_sel on attachments for select using ( can_see(project_id) );
create policy a_ins on attachments for insert with check (
  can_act(project_id) or exists (
    select 1 from projects p where p.id = project_id and my_team() = any(p.involved_teams)
  )
);

-- Realtime so every logged-in client updates the instant anything changes.
alter publication supabase_realtime add table projects, subtasks, stage_history, comments, attachments, stage_targets;

-- ══════════════════════════════════════════════════════════════
-- Directory access + magic-link claim
-- People rows are pre-seeded by an admin script (service role key), one per
-- org member. auth_id starts null; the first successful login for that email
-- claims the row via claim_person(), driven by the verified JWT — never by
-- client-supplied input. Anyone who signs in but isn't in `people` yet is
-- authenticated (has a Supabase session) but owns zero rows anywhere else,
-- because every other RLS policy is keyed off my_team()/my_role(), which are
-- both null for them. That's the whole access gate for this internal tool.
-- ══════════════════════════════════════════════════════════════
alter table people enable row level security;
create policy people_sel on people for select using ( auth.role() = 'authenticated' );

create or replace function claim_person() returns people language plpgsql security definer as $$
declare rec people;
begin
  update people set auth_id = auth.uid()
    where email = lower(auth.jwt() ->> 'email') and auth_id is null
    returning * into rec;
  if rec.id is null then
    select * into rec from people where auth_id = auth.uid();
  end if;
  return rec;
end;
$$;

-- Phase 2 hook: a scheduled Edge Function scans stage_entered_at vs an SLA table and
-- emails/Slacks the current owner + PMO on breach; a trigger on `comments`
-- where pinned = true notifies the owning team of a leadership priority note.

-- Optional future migration: role_id enum — add 'manager' if you want a
-- distinct manager tier (currently managers use 'lead' + team='tech_spoc').
-- alter type role_id add value if not exists 'manager';
