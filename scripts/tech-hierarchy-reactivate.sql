-- ══════════════════════════════════════════════════════════════
-- Tech org hierarchy reactivation (2026-09-08).
--
-- Rajneesh Gupta (CTO) -> Kalyan Singh (AVP) / Abhishek Sharma (VP) /
-- Ashish Aggarwal (SVP) / Gautam Kumar (SVP) -> ~60 people, transcribed
-- from tech_team_hierarchy_with_designation.pdf. This is the SAME roster
-- an earlier pass through this session mistakenly retired (auth_id nulled,
-- active=false), on the wrong assumption that the separate Senior/Junior/
-- Sub Junior spreadsheet (Kavish/Neha/Anjali Gupta/Khushboo Nagpal/Gautam
-- Mehra — see hierarchy-seed.sql) replaced it. It doesn't: that roster is
-- the Business hierarchy, this one is Tech — two independent branches
-- under two different roots, confirmed with the org. All manager_id/
-- department/role/team data was left untouched by the retirement (only
-- auth_id and active were flipped), so this just flips them back — no
-- re-transcription needed.
--
-- Idempotent: safe to re-run. Anandita and Pooja are real people who
-- appear in BOTH this PDF and were pre-existing accounts (Product lead,
-- QA member respectively, decided before this hierarchy existed) — their
-- team/role stay exactly as already decided; only their manager_id/
-- department (which fell out of the tree during the mistaken retirement)
-- are restored to match this PDF (Anandita -> Gautam Kumar / Project
-- mgmt, Pooja -> Rishabh Srivastav / Testing).
-- ══════════════════════════════════════════════════════════════

with recursive tech_tree as (
  select id from people where email in
    ('abhishek.sharma@gyftr.net','ashish.aggarwal@gyftr.net','gautam.kumar@gyftr.net','kalyan.singh@gyftr.net')
  union all
  select p.id from people p join tech_tree t on p.manager_id = t.id
)
update people set active = true where id in (select id from tech_tree);

update people set active = true where email = 'rajneesh@gyftr.net'; -- CTO, root of the tree

update people set
  manager_id = (select id from people where email = 'gautam.kumar@gyftr.net'),
  department = 'Project mgmt',
  active = true
where email = 'anandita@gyftr.net';

update people set
  manager_id = (select id from people where email = 'rishabh.srivastav@gyftr.net'),
  department = 'Testing',
  active = true
where email = 'pooja@gyftr.net';
