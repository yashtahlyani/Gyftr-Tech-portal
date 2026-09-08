-- ══════════════════════════════════════════════════════════════
-- Real Tech org hierarchy seed, transcribed from the Tech Team
-- Hierarchy Excel (2026-09-08). Replaces the demo Product/Tech
-- SPOC/Development/Design/QA roster with the real ~80-person org.
-- Business/Leadership/Partner people are untouched — the Excel is
-- Tech-only, so nothing in it could replace them.
--
-- Idempotent: every insert is `on conflict (email) do update`, safe
-- to re-run. Ordered top-down (managers before their reports) so each
-- `manager_id` subquery resolves against a row that already exists.
--
-- Two people are MERGES with existing rows, not new people (confirmed
-- with the user): "Anandita" (existing Tech SPOC lead) is the same
-- real person as the Excel's Ms. Anandita, Project Management lead
-- under Gautam Kumar — her team changes from tech_spoc to product.
-- "Pooja" (existing QA member) is the same real person as the Excel's
-- Pooja, Testing, under Rishabh Srivastav — team stays qa, unchanged.
--
-- REVIEW THIS AGAINST THE ORIGINAL EXCEL BEFORE RUNNING — transcribed
-- from a screenshot, so worth a careful line-by-line check first.
-- ══════════════════════════════════════════════════════════════

-- Old demo-only Tech people being retired (kept out of both merge
-- list above): clear their auth_id so old logins stop working, but
-- leave the rows in place (referenced by historical projects/history/
-- comments — deleting would break FK integrity on real data).
update people set auth_id = null
 where email in (
   'saurabh@gyftr.net','siddharth@gyftr.net','yash.tahlyani@gyftr.net',
   'deepak@gyftr.net','harshita@gyftr.net','pankaj@gyftr.net','sameer@gyftr.net',
   'anmol@gyftr.net','raj@gyftr.net','vikas@gyftr.net','rajkumar@gyftr.net','karan@gyftr.net'
 );

-- Rajneesh Gupta already exists (rajneesh@gyftr.net, role=pmo) — he's
-- root of the tree. No role change needed: pmo already grants exactly
-- the global visibility+action rights a CTO needs.
update people set manager_id = null where email = 'rajneesh@gyftr.net';

-- ── The two merges ──
update people set team = 'product', role = 'lead', department = 'Project Management',
  manager_id = (select id from people where email = 'gautam.kumar@gyftr.net')
 where email = 'anandita@gyftr.net';
-- (manager_id set in a second pass below, once gautam.kumar@gyftr.net exists)

update people set department = 'Testing',
  manager_id = (select id from people where email = 'rishabh.srivastav@gyftr.net')
 where email = 'pooja@gyftr.net';
-- (manager_id set in a second pass below, once rishabh.srivastav@gyftr.net exists — team stays qa, unchanged)

-- ── Branch heads (SVPs) — direct reports of the CTO ──
insert into people (name, email, team, role, department, manager_id) values
  ('Abhishek Sharma', 'abhishek.sharma@gyftr.net', 'development', 'svp', null, (select id from people where email='rajneesh@gyftr.net')),
  ('Ashish Aggarwal', 'ashish.aggarwal@gyftr.net', 'development', 'svp', null, (select id from people where email='rajneesh@gyftr.net')),
  ('Gautam Kumar', 'gautam.kumar@gyftr.net', 'development', 'svp', null, (select id from people where email='rajneesh@gyftr.net')),
  ('Kalyan Singh', 'kalyan.singh@gyftr.net', 'development', 'svp', null, (select id from people where email='rajneesh@gyftr.net'))
on conflict (email) do update set team=excluded.team, role=excluded.role, department=excluded.department, manager_id=excluded.manager_id;

-- Now that Gautam Kumar exists, finish Anandita's merge.
update people set manager_id = (select id from people where email = 'gautam.kumar@gyftr.net')
 where email = 'anandita@gyftr.net';
-- (Pooja's merge finishes after the AVP/TL block below, once rishabh.srivastav@gyftr.net exists)

-- ── AVPs/TLs — direct reports of a branch head ──
insert into people (name, email, team, role, department, manager_id) values
  ('Anuj Kumar Shukla', 'anuj.shukla@gyftr.net', 'development', 'lead', 'E-Pay', (select id from people where email='abhishek.sharma@gyftr.net')),
  ('Keshav Mantri', 'keshav.mantri@gyftr.net', 'development', 'lead', 'E-Pay', (select id from people where email='abhishek.sharma@gyftr.net')),
  ('Vineet Kumar', 'vineet.kumar@gyftr.net', 'development', 'lead', 'DCMS', (select id from people where email='abhishek.sharma@gyftr.net')),

  ('Brijesh Kumar', 'brijesh.kumar@gyftr.net', 'development', 'lead', 'Communication Engine', (select id from people where email='ashish.aggarwal@gyftr.net')),
  ('Kuldip Sehgal', 'kuldip.sehgal@gyftr.net', 'development', 'lead', 'Infra', (select id from people where email='ashish.aggarwal@gyftr.net')),
  ('Kuldeep Dhouni', 'kuldeep.dhouni@gyftr.net', 'development', 'lead', 'PG', (select id from people where email='ashish.aggarwal@gyftr.net')),
  ('Rishabh Srivastav', 'rishabh.srivastav@gyftr.net', 'qa', 'lead', 'Testing', (select id from people where email='ashish.aggarwal@gyftr.net')),

  ('Raj Kumar Rajbanshi', 'raj.rajbanshi@gyftr.net', 'development', 'lead', 'DevOps', (select id from people where email='gautam.kumar@gyftr.net')),
  ('Zeyad Haque', 'zeyad.haque@gyftr.net', 'design', 'lead', 'UI/UX', (select id from people where email='gautam.kumar@gyftr.net')),
  ('Raj Kumar', 'raj.kumar@gyftr.net', 'development', 'lead', 'B2C Backend', (select id from people where email='gautam.kumar@gyftr.net')),
  ('Anmol Kumar', 'anmol.kumar@gyftr.net', 'development', 'lead', 'B2C Frontend', (select id from people where email='gautam.kumar@gyftr.net')),
  ('Shivam Sharma', 'shivam.sharma@gyftr.net', 'development', 'lead', 'B2C Frontend', (select id from people where email='gautam.kumar@gyftr.net')),
  ('Sopan Mittal', 'sopan.mittal@gyftr.net', 'development', 'lead', 'GyFTR', (select id from people where email='gautam.kumar@gyftr.net')),
  ('Akash Singh', 'akash.singh@gyftr.net', 'development', 'lead', 'Promotions', (select id from people where email='gautam.kumar@gyftr.net')),

  ('Ankush Chaudhary', 'ankush.chaudhary@gyftr.net', 'development', 'lead', 'MIS', (select id from people where email='kalyan.singh@gyftr.net'))
on conflict (email) do update set team=excluded.team, role=excluded.role, department=excluded.department, manager_id=excluded.manager_id;

-- Now that Rishabh Srivastav exists, finish Pooja's merge.
update people set manager_id = (select id from people where email = 'rishabh.srivastav@gyftr.net')
 where email = 'pooja@gyftr.net';

-- ── Sub-TLs with their own reports ──
insert into people (name, email, team, role, department, manager_id) values
  ('Pranesh Roy', 'pranesh.roy@gyftr.net', 'development', 'lead', 'PG', (select id from people where email='kuldeep.dhouni@gyftr.net')),
  ('Vikas Umrao', 'vikas.umrao@gyftr.net', 'development', 'lead', 'B2C Backend', (select id from people where email='raj.kumar@gyftr.net')),
  ('Ravikant Maurya', 'ravikant.maurya@gyftr.net', 'development', 'lead', 'B2C Backend', (select id from people where email='raj.kumar@gyftr.net')),
  ('Sarvnarayan Singh', 'sarvnarayan.singh@gyftr.net', 'development', 'lead', 'B2C Frontend', (select id from people where email='anmol.kumar@gyftr.net'))
on conflict (email) do update set team=excluded.team, role=excluded.role, department=excluded.department, manager_id=excluded.manager_id;

-- ── Team members (leaf level) ──
insert into people (name, email, team, role, department, manager_id) values
  ('Dinesh Singh', 'dinesh.singh@gyftr.net', 'development', 'member', 'E-Pay', (select id from people where email='anuj.shukla@gyftr.net')),
  ('Ravi Kumar Pal', 'ravi.pal@gyftr.net', 'development', 'member', 'E-Pay', (select id from people where email='keshav.mantri@gyftr.net')),
  ('Kantesh Choudhary', 'kantesh.choudhary@gyftr.net', 'development', 'member', 'E-Pay', (select id from people where email='keshav.mantri@gyftr.net')),
  ('Puneet Tanwar', 'puneet.tanwar@gyftr.net', 'development', 'member', 'DCMS', (select id from people where email='vineet.kumar@gyftr.net')),
  ('Avadesh Kumar', 'avadesh.kumar@gyftr.net', 'development', 'member', 'DCMS', (select id from people where email='vineet.kumar@gyftr.net')),
  ('Mukesh Kumar Jha', 'mukesh.jha@gyftr.net', 'development', 'member', 'DCMS', (select id from people where email='vineet.kumar@gyftr.net')),

  ('Manish Aithani', 'manish.aithani@gyftr.net', 'development', 'member', 'Communication Engine', (select id from people where email='brijesh.kumar@gyftr.net')),
  ('Ayush Garg', 'ayush.garg@gyftr.net', 'development', 'member', 'Communication Engine', (select id from people where email='brijesh.kumar@gyftr.net')),

  ('Rakesh Kumar', 'rakesh.kumar@gyftr.net', 'development', 'member', 'Infra', (select id from people where email='kuldip.sehgal@gyftr.net')),
  ('Suresh Chand', 'suresh.chand@gyftr.net', 'development', 'member', 'Infra', (select id from people where email='kuldip.sehgal@gyftr.net')),
  ('Daksh Morya', 'daksh.morya@gyftr.net', 'development', 'member', 'Infra', (select id from people where email='kuldip.sehgal@gyftr.net')),
  ('Chhavi Krishan Gautam', 'chhavi.gautam@gyftr.net', 'development', 'member', 'Infra', (select id from people where email='kuldip.sehgal@gyftr.net')),

  ('Kshitij Rana', 'kshitij.rana@gyftr.net', 'development', 'member', 'PG', (select id from people where email='pranesh.roy@gyftr.net')),
  ('Meraj Ahmad', 'meraj.ahmad@gyftr.net', 'development', 'member', 'PG', (select id from people where email='pranesh.roy@gyftr.net')),
  ('Kalim Ahamad', 'kalim.ahamad@gyftr.net', 'development', 'member', 'PG', (select id from people where email='kuldeep.dhouni@gyftr.net')),
  ('Arvind Kumar Yadav', 'arvind.yadav@gyftr.net', 'development', 'member', 'PG', (select id from people where email='kuldeep.dhouni@gyftr.net')),
  ('Amit Kumar', 'amit.kumar@gyftr.net', 'development', 'member', 'PG', (select id from people where email='kuldeep.dhouni@gyftr.net')),

  ('Arjun Singh', 'arjun.singh@gyftr.net', 'qa', 'member', 'Testing', (select id from people where email='rishabh.srivastav@gyftr.net')),
  ('Mahima Sharma', 'mahima.sharma@gyftr.net', 'qa', 'member', 'Testing', (select id from people where email='rishabh.srivastav@gyftr.net')),
  ('Kunal Verma', 'kunal.verma@gyftr.net', 'qa', 'member', 'Testing', (select id from people where email='rishabh.srivastav@gyftr.net')),
  ('Madhurika', 'madhurika@gyftr.net', 'qa', 'member', 'Testing', (select id from people where email='rishabh.srivastav@gyftr.net')),
  ('Ankur', 'ankur@gyftr.net', 'qa', 'member', 'Testing', (select id from people where email='rishabh.srivastav@gyftr.net')),

  ('Chandan Prajapati', 'chandan.prajapati@gyftr.net', 'development', 'member', 'DevOps', (select id from people where email='raj.rajbanshi@gyftr.net')),
  ('Roushan Kumar', 'roushan.kumar@gyftr.net', 'design', 'member', 'UI/UX', (select id from people where email='zeyad.haque@gyftr.net')),

  ('Ravinder Kumar', 'ravinder.kumar@gyftr.net', 'development', 'member', 'B2C Backend', (select id from people where email='vikas.umrao@gyftr.net')),
  ('Kawaleet', 'kawaleet@gyftr.net', 'development', 'member', 'B2C Backend', (select id from people where email='vikas.umrao@gyftr.net')),
  ('Anuj Gupta', 'anuj.gupta@gyftr.net', 'development', 'member', 'B2C Backend', (select id from people where email='ravikant.maurya@gyftr.net')),
  ('Gaurav Pandey', 'gaurav.pandey@gyftr.net', 'development', 'member', 'B2C Backend', (select id from people where email='ravikant.maurya@gyftr.net')),

  ('Tarun Rathore', 'tarun.rathore@gyftr.net', 'development', 'member', 'B2C Frontend', (select id from people where email='sarvnarayan.singh@gyftr.net')),
  ('Shivam Arora', 'shivam.arora@gyftr.net', 'development', 'member', 'B2C Frontend', (select id from people where email='anmol.kumar@gyftr.net')),
  ('Teena', 'teena@gyftr.net', 'development', 'member', 'B2C Frontend', (select id from people where email='shivam.sharma@gyftr.net')),

  ('Vinit Kumar', 'vinit.kumar@gyftr.net', 'development', 'member', 'GyFTR', (select id from people where email='sopan.mittal@gyftr.net')),
  ('Ashwani', 'ashwani@gyftr.net', 'development', 'member', 'GyFTR', (select id from people where email='sopan.mittal@gyftr.net')),
  ('Rahul Kumar', 'rahul.kumar@gyftr.net', 'development', 'member', 'GyFTR', (select id from people where email='sopan.mittal@gyftr.net')),

  ('Manish Kumar', 'manish.kumar@gyftr.net', 'development', 'member', 'Promotions', (select id from people where email='akash.singh@gyftr.net')),
  ('Deepika', 'deepika@gyftr.net', 'development', 'member', 'Promotions', (select id from people where email='akash.singh@gyftr.net'))
on conflict (email) do update set team=excluded.team, role=excluded.role, department=excluded.department, manager_id=excluded.manager_id;
