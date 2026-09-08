-- ══════════════════════════════════════════════════════════════
-- Tech org hierarchy seed (2026-09-08), Senior -> Junior -> Sub Junior,
-- transcribed from the org's own spreadsheet.
--
-- This REPLACES an earlier hierarchy import (SVP/AVP/TL, transcribed from
-- a different Excel on 2026-09-07) — that whole roster is retired below,
-- not deleted (their rows stay for FK/history integrity — old projects
-- still resolve their name — just active=false, so they can't log in and
-- never appear in any assignment/owner picker). Two people are carried
-- over as merges, not new rows: Anandita
-- and Pooja were existing accounts touched by the retired import; this
-- script reverts their hierarchy fields (they're not in the new roster
-- either) while leaving their team/role exactly as already decided.
--
-- Idempotent: every insert is `on conflict (email) do update`, safe to
-- re-run. Ordered top-down (managers before their reports) so each
-- `manager_id` subquery resolves against a row that already exists.
--
-- Two email domains are both valid logins (see src/auth.ts's
-- ALLOWED_DOMAINS) — @gyftr.com is this roster's real domain, not a typo,
-- confirmed with the org. "New member" (no email given, one row in the
-- source spreadsheet) was skipped entirely rather than inventing an identity.
--
-- REVIEW THIS AGAINST THE SOURCE SPREADSHEET BEFORE RE-RUNNING — hand
-- transcribed from a screenshot, worth a careful line-by-line check.
-- ══════════════════════════════════════════════════════════════

-- ── Retire the previous (2026-09-07) hierarchy import ──
with recursive old_tree as (
  select id from people where email in
    ('abhishek.sharma@gyftr.net','ashish.aggarwal@gyftr.net','gautam.kumar@gyftr.net','kalyan.singh@gyftr.net')
  union all
  select p.id from people p join old_tree t on p.manager_id = t.id
)
update people set auth_id = null, active = false
 where id in (select id from old_tree)
   and email not in ('anandita@gyftr.net', 'pooja@gyftr.net');

update people set manager_id = null, department = null where email in ('anandita@gyftr.net', 'pooja@gyftr.net');

-- ── New hierarchy. team='partner' for brand-new people: an inert court
-- team (no pipeline stage is owned by it, and it's otherwise unused across
-- every live project), so their visibility comes entirely from the
-- structural subtree rule (roles.ts's orgSubtreeIds / schema's
-- my_subtree_ids()), never accidentally from team-court matching.
-- CAUTION: if you ever assign a subtask with team='partner' for any reason
-- (including testing), remember involved_teams only ever grows — it will
-- stick to that project permanently and broaden every 'partner'-team
-- person's visibility into it. Verified live and hit exactly this during
-- development; see git history for the cleanup.

-- Two of the five "Senior" roots merge into existing accounts (same real
-- people as the existing Business team, confirmed with the org).
update people set manager_id = null where email = 'neha@gyftr.net';         -- Neha Sharma
update people set manager_id = null where email = 'anjali.gupta@gyftr.net'; -- Anjali Gupta

insert into people (name, email, team, role, manager_id) values
  ('Kavish', 'kavish@gyftr.com', 'partner', 'lead', null),
  ('Khushboo Nagpal', 'khushboo.n@gyftr.com', 'partner', 'lead', null),
  ('Gautam Mehra', 'gautam.m@gyftr.com', 'partner', 'lead', null)
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;

-- Kavish's branch
insert into people (name, email, team, role, manager_id) values
  ('Sidak', 'sidak@gyftr.com', 'partner', 'member', (select id from people where email='kavish@gyftr.com')),
  ('Ritvik Sikka', 'ritvik.sikka@gyftr.com', 'partner', 'member', (select id from people where email='kavish@gyftr.com')),
  ('Mohit Chauhan', 'mohit.c@gyftr.com', 'partner', 'lead', (select id from people where email='kavish@gyftr.com'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;
insert into people (name, email, team, role, manager_id) values
  ('Riya Sinha', 'riya.s@gyftr.com', 'partner', 'member', (select id from people where email='mohit.c@gyftr.com')),
  ('Harshita Kumar', 'harshita.k@gyftr.com', 'partner', 'member', (select id from people where email='mohit.c@gyftr.com')),
  ('Nikita Pandey', 'nikita.pandey@gyftr.com', 'partner', 'member', (select id from people where email='mohit.c@gyftr.com'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;

-- Neha Sharma's branch
insert into people (name, email, team, role, manager_id) values
  ('Biren Pal Singh', 'biren.singh@gyftr.com', 'partner', 'member', (select id from people where email='neha@gyftr.net')),
  ('Rajeev Magan', 'rajeev.m@gyftr.com', 'partner', 'member', (select id from people where email='neha@gyftr.net')),
  ('Alisha Dutta', 'alisha.dutta@gyftr.com', 'partner', 'member', (select id from people where email='neha@gyftr.net'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;

-- Anjali Gupta's branch
insert into people (name, email, team, role, manager_id) values
  ('Pratistha Rawat', 'pratishtha.r@gyftr.com', 'partner', 'lead', (select id from people where email='anjali.gupta@gyftr.net')),
  ('Shradha Pratap Singh', 'shradha.s@gyftr.com', 'partner', 'lead', (select id from people where email='anjali.gupta@gyftr.net'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;
insert into people (name, email, team, role, manager_id) values
  ('Rohan Mathur', 'rohan.mathur@gyftr.com', 'partner', 'member', (select id from people where email='pratishtha.r@gyftr.com')),
  ('Krish Chanana', 'krish.c@gyftr.com', 'partner', 'member', (select id from people where email='pratishtha.r@gyftr.com')),
  ('Garima Titoria', 'garima.titoria@gyftr.com', 'partner', 'member', (select id from people where email='pratishtha.r@gyftr.com')),
  ('Srishty Adlakha', 'srishty.a@gyftr.com', 'partner', 'member', (select id from people where email='shradha.s@gyftr.com')),
  ('Karan Jha', 'karan.jha@gyftr.com', 'partner', 'member', (select id from people where email='shradha.s@gyftr.com')),
  ('Simran', 'simran@gyftr.com', 'partner', 'member', (select id from people where email='shradha.s@gyftr.com'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;

-- Khushboo Nagpal's branch ("New member" row skipped — no email given)
insert into people (name, email, team, role, manager_id) values
  ('Rewa Kauseeka', 'rewa.k@gyftr.com', 'partner', 'member', (select id from people where email='khushboo.n@gyftr.com')),
  ('Plaban Roy', 'plaban.r@gyftr.com', 'partner', 'member', (select id from people where email='khushboo.n@gyftr.com')),
  ('Geetanjali Narula', 'geetanjali.n@gyftr.com', 'partner', 'member', (select id from people where email='khushboo.n@gyftr.com')),
  ('Ashutosh Kumar', 'ashutosh.k@gyftr.com', 'partner', 'member', (select id from people where email='khushboo.n@gyftr.com'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;

-- Gautam Mehra's branch
insert into people (name, email, team, role, manager_id) values
  ('Rohit Kothiyal', 'rohit.k@gyftr.com', 'partner', 'lead', (select id from people where email='gautam.m@gyftr.com')),
  ('Shubhranil Chowdhary', 'shubhranil.c@gyftr.com', 'partner', 'member', (select id from people where email='gautam.m@gyftr.com')),
  ('Minal Bhutani', 'minal.b@gyftr.com', 'partner', 'member', (select id from people where email='gautam.m@gyftr.com')),
  ('Rishiraj Singh Shekhawat', 'rishiraj.shekhawat@gyftr.com', 'partner', 'member', (select id from people where email='gautam.m@gyftr.com')),
  ('Riya Ohri', 'riya.ohri@gyftr.com', 'partner', 'member', (select id from people where email='gautam.m@gyftr.com')),
  ('Aditya Joshi', 'aditya.joshi@gyftr.com', 'partner', 'member', (select id from people where email='gautam.m@gyftr.com'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;
insert into people (name, email, team, role, manager_id) values
  ('Akash Shukla', 'akash.shukla@gyftr.com', 'partner', 'member', (select id from people where email='rohit.k@gyftr.com'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;

-- ── The five Product people who see every project (explicit named grant,
-- not a hierarchy derivation — see people.sees_all_projects). Saurabh/
-- Siddharth already exist; Anirudh/Divyam/Harshita are new. This Harshita is
-- NOT the retired Tech-SPOC Harshita nor the new hierarchy's Harshita Kumar
-- (Sub Junior under Kavish) — a distinct person, flagged with a
-- disambiguating email since no surname was given.
update people set sees_all_projects = true where email in ('saurabh@gyftr.net', 'siddharth@gyftr.net');
insert into people (name, email, team, role, sees_all_projects) values
  ('Anirudh', 'anirudh@gyftr.net', 'product', 'lead', true),
  ('Divyam', 'divyam@gyftr.net', 'product', 'member', true),
  ('Harshita', 'harshita.product@gyftr.net', 'product', 'member', true)
on conflict (email) do update set team=excluded.team, role=excluded.role, sees_all_projects=excluded.sees_all_projects;
