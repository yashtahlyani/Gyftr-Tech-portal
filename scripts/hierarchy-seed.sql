-- ══════════════════════════════════════════════════════════════
-- Business org hierarchy seed (2026-09-08), Senior -> Junior -> Sub Junior,
-- transcribed from the org's own spreadsheet.
--
-- Coexists with, does NOT replace, the separate Tech hierarchy (Rajneesh
-- Gupta CTO -> Kalyan Singh/Abhishek Sharma/Ashish Aggarwal/Gautam Kumar,
-- ~60 people — see tech-hierarchy-reactivate.sql). An earlier pass through
-- this session briefly (and incorrectly) retired the Tech hierarchy under
-- the assumption this roster replaced it; that was wrong and has been
-- reversed — the two are independent branches under two different roots,
-- both real, both active. Kept here as a correction note so the mistake
-- isn't repeated.
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

-- ── New hierarchy. team='business' for brand-new people — not 'partner'
-- (an earlier version of this script used the inert 'partner' team purely
-- to sidestep cross-branch visibility leakage; that broke something more
-- basic — nobody outside the 5 roots could even CREATE a project, since
-- p_ins/can()'s "create" check requires team in business/product/tech_spoc).
-- team='business' is correct here — it's their real function — and cross-
-- branch isolation is instead handled by has_coarse_team_leak() including
-- 'business' in its coarse set (see schema.sql), the same mechanism already
-- built for the Tech hierarchy's development/qa/design courts. Their
-- visibility/action rights are structural (subtree-based), never plain
-- team-court matching, exactly like the Tech hierarchy.

-- Two of the five "Senior" roots merge into existing accounts (same real
-- people as the existing Business team, confirmed with the org).
update people set manager_id = null where email = 'neha@gyftr.net';         -- Neha Sharma
update people set manager_id = null where email = 'anjali.gupta@gyftr.net'; -- Anjali Gupta

insert into people (name, email, team, role, manager_id) values
  ('Kavish', 'kavish@gyftr.com', 'business', 'lead', null),
  ('Khushboo Nagpal', 'khushboo.n@gyftr.com', 'business', 'lead', null),
  ('Gautam Mehra', 'gautam.m@gyftr.com', 'business', 'lead', null)
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;

-- Kavish's branch
insert into people (name, email, team, role, manager_id) values
  ('Sidak', 'sidak@gyftr.com', 'business', 'member', (select id from people where email='kavish@gyftr.com')),
  ('Ritvik Sikka', 'ritvik.sikka@gyftr.com', 'business', 'member', (select id from people where email='kavish@gyftr.com')),
  ('Mohit Chauhan', 'mohit.c@gyftr.com', 'business', 'lead', (select id from people where email='kavish@gyftr.com'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;
insert into people (name, email, team, role, manager_id) values
  ('Riya Sinha', 'riya.s@gyftr.com', 'business', 'member', (select id from people where email='mohit.c@gyftr.com')),
  ('Harshita Kumar', 'harshita.k@gyftr.com', 'business', 'member', (select id from people where email='mohit.c@gyftr.com')),
  ('Nikita Pandey', 'nikita.pandey@gyftr.com', 'business', 'member', (select id from people where email='mohit.c@gyftr.com'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;

-- Neha Sharma's branch
insert into people (name, email, team, role, manager_id) values
  ('Biren Pal Singh', 'biren.singh@gyftr.com', 'business', 'member', (select id from people where email='neha@gyftr.net')),
  ('Rajeev Magan', 'rajeev.m@gyftr.com', 'business', 'member', (select id from people where email='neha@gyftr.net')),
  ('Alisha Dutta', 'alisha.dutta@gyftr.com', 'business', 'member', (select id from people where email='neha@gyftr.net'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;

-- Anjali Gupta's branch
insert into people (name, email, team, role, manager_id) values
  ('Pratistha Rawat', 'pratishtha.r@gyftr.com', 'business', 'lead', (select id from people where email='anjali.gupta@gyftr.net')),
  ('Shradha Pratap Singh', 'shradha.s@gyftr.com', 'business', 'lead', (select id from people where email='anjali.gupta@gyftr.net'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;
insert into people (name, email, team, role, manager_id) values
  ('Rohan Mathur', 'rohan.mathur@gyftr.com', 'business', 'member', (select id from people where email='pratishtha.r@gyftr.com')),
  ('Krish Chanana', 'krish.c@gyftr.com', 'business', 'member', (select id from people where email='pratishtha.r@gyftr.com')),
  ('Garima Titoria', 'garima.titoria@gyftr.com', 'business', 'member', (select id from people where email='pratishtha.r@gyftr.com')),
  ('Srishty Adlakha', 'srishty.a@gyftr.com', 'business', 'member', (select id from people where email='shradha.s@gyftr.com')),
  ('Karan Jha', 'karan.jha@gyftr.com', 'business', 'member', (select id from people where email='shradha.s@gyftr.com')),
  ('Simran', 'simran@gyftr.com', 'business', 'member', (select id from people where email='shradha.s@gyftr.com'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;

-- Khushboo Nagpal's branch ("New member" row skipped — no email given)
insert into people (name, email, team, role, manager_id) values
  ('Rewa Kauseeka', 'rewa.k@gyftr.com', 'business', 'member', (select id from people where email='khushboo.n@gyftr.com')),
  ('Plaban Roy', 'plaban.r@gyftr.com', 'business', 'member', (select id from people where email='khushboo.n@gyftr.com')),
  ('Geetanjali Narula', 'geetanjali.n@gyftr.com', 'business', 'member', (select id from people where email='khushboo.n@gyftr.com')),
  ('Ashutosh Kumar', 'ashutosh.k@gyftr.com', 'business', 'member', (select id from people where email='khushboo.n@gyftr.com'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;

-- Gautam Mehra's branch
insert into people (name, email, team, role, manager_id) values
  ('Rohit Kothiyal', 'rohit.k@gyftr.com', 'business', 'lead', (select id from people where email='gautam.m@gyftr.com')),
  ('Shubhranil Chowdhary', 'shubhranil.c@gyftr.com', 'business', 'member', (select id from people where email='gautam.m@gyftr.com')),
  ('Minal Bhutani', 'minal.b@gyftr.com', 'business', 'member', (select id from people where email='gautam.m@gyftr.com')),
  ('Rishiraj Singh Shekhawat', 'rishiraj.shekhawat@gyftr.com', 'business', 'member', (select id from people where email='gautam.m@gyftr.com')),
  ('Riya Ohri', 'riya.ohri@gyftr.com', 'business', 'member', (select id from people where email='gautam.m@gyftr.com')),
  ('Aditya Joshi', 'aditya.joshi@gyftr.com', 'business', 'member', (select id from people where email='gautam.m@gyftr.com'))
on conflict (email) do update set team=excluded.team, role=excluded.role, manager_id=excluded.manager_id;
insert into people (name, email, team, role, manager_id) values
  ('Akash Shukla', 'akash.shukla@gyftr.com', 'business', 'member', (select id from people where email='rohit.k@gyftr.com'))
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
