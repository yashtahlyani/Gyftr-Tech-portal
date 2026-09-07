Gyftr Tech Portal
Complete Setup, Deployment & Handover Guide
This document provides all the information required to set up, migrate, deploy, operate, and maintain the Gyftr Tech Portal.
It is intended to serve as a complete technical handover for the next developer or administrator responsible for the portal.
Please read the document completely before beginning the migration or deployment process.

1. Portal Overview
The Gyftr Tech Portal is an internal project tracker used across Business, Product, Tech SPOC, Development, Design, QA, and Leadership to run every project through its full lifecycle — replaces the old PM Activity List spreadsheet.
The portal enables team members, leads, and PMO to:
Create and track projects through an 8-stage pipeline (Intake → Scoping → To Be Picked → Development → QA → UAT → Pending Deploy → Live)
Assign and manage sub-tasks within a project
Set and track an expected date for every stage, enforced in order
Log stage-by-stage handoff history automatically
Add comments, including pinned leadership priority notes
Attach documents/links (BRD, PRD, Figma, etc.)
Flag and track blocked projects with a reason
Monitor SLA breaches, overdue go-lives, and escalations
View dashboards, the full flow board, and a filterable all-projects table
Technology Stack
Frontend: React + Vite (TypeScript)
Backend: Node.js (Express)
Database: PostgreSQL
Authentication: AWS Cognito
Backend Hosting: AWS EC2 (behind an Application Load Balancer)
Frontend Hosting: AWS S3 + CloudFront
Database Hosting: AWS RDS
Secrets Management: AWS Secrets Manager
Current State
At the time of handover:
The application code is complete — backend, frontend, migration scripts, and this guide are all in the GitHub repo.
Existing production data is stored in Supabase (Postgres + Auth + Realtime).
The new backend uses PostgreSQL on AWS RDS, with all authorization logic re-implemented server-side (RDS has no Row-Level Security — the Express API is the security boundary instead).
Authentication moves from Supabase Auth to AWS Cognito.
The frontend will be hosted using S3 and CloudFront.
The backend API will run on EC2 behind an Application Load Balancer.
Nothing has been provisioned on AWS yet — no AWS account access was available while building this. The primary remaining task is to provision the AWS resources below, migrate the existing Supabase data, and deploy.

2. Project Resources
Git Repository
https://github.com/yashtahlyani/Gyftr-Tech-portal
(also mirrored at https://github.com/yashtahlyani8-ui/Gyftr-Tech-portal)
Existing System
The current application data is stored in Supabase.
Supabase is required only during the migration process. Once the AWS deployment and data migration have been verified successfully, Supabase credentials should be revoked.

3. Credentials & Security
Sensitive credentials should never be committed to GitHub or stored directly inside the application source code. (This repo's backend/.env, .env, and scripts/aws-migration/.env are all git-ignored by default — only the matching .env.example files are tracked.)
Supabase Migration Credentials
Supabase Project URL: https://jrujrhjxuikdsrblsbur.supabase.co
Supabase Service Role Key: get this fresh from Supabase Dashboard → Project Settings → API → service_role (do not reuse any key that has ever been pasted into a chat, ticket, or doc — treat any such key as already compromised and rotate it first)
This must be the project's service_role key (Project Settings → API), not a personal access token from Account → Access Tokens — the migration script (scripts/aws-migration/migrate-db.mjs) reads every table directly via the Supabase REST API using this key, bypassing RLS.
The service role key is required only during database migration.
After migration has been completed and verified, rotate/revoke it from:
Supabase Dashboard → Project Settings → API → service_role → Reset
Important
Store production credentials securely using:
AWS Secrets Manager
Environment variables
Approved organizational password-management systems
Do not share production passwords or access keys through email, chat, or documentation intended for general circulation.

4. User Accounts & Roles
All users authenticate using their @gyftr.net email addresses. The app rejects any other domain at login.
Unlike a typical app, every account shares one permanent password by design — the login screen is a one-click "pick your name" list, not a typed login form. Clicking a name signs that person in with the shared password behind the scenes. This was a deliberate choice carried over from the original Supabase version, not a shortcut introduced by this migration.
Shared password for every account: default@123
PMO (process owner — can act on any project regardless of team)
Rajneesh — rajneesh@gyftr.net (Tech SPOC team, PMO role)
PMO Office — pmo@gyftr.net (Leadership team, PMO role)
Leadership (read-only observer — full visibility, cannot edit anything except leaving comments)
Leadership — leadership@gyftr.net
Business Team
Anjali Gupta (Lead) — anjali.gupta@gyftr.net
Neha (Lead) — neha@gyftr.net
Priya Sharma — priya.sharma@gyftr.net
Rahul Joshi — rahul.joshi@gyftr.net
Product Team
Saurabh (Lead) — saurabh@gyftr.net
Siddharth (Lead) — siddharth@gyftr.net
Yash Tahlyani — yash.tahlyani@gyftr.net
Tech SPOC Team
Anandita (Lead) — anandita@gyftr.net
Deepak — deepak@gyftr.net
Harshita — harshita@gyftr.net
Pankaj — pankaj@gyftr.net
Sameer — sameer@gyftr.net
Development Team
Anmol — anmol@gyftr.net
Raj — raj@gyftr.net
Vikas — vikas@gyftr.net
Design Team
Rajkumar — rajkumar@gyftr.net
QA Team
Karan (Lead) — karan@gyftr.net
Pooja — pooja@gyftr.net
Team leads and PMO can act on any project their team/role gives them authority over; ordinary members act only on projects their team currently holds (mirrors backend/authz.js exactly).

5. Prerequisites
Before beginning deployment, ensure you have:
An AWS account with billing enabled
Node.js v18 or higher
Git installed
PostgreSQL command-line tools (psql), or any GUI Postgres client
AWS CLI, configured with credentials that can manage RDS/Cognito/EC2/S3/CloudFront/Secrets Manager/IAM
Access to the project's GitHub repository
Access to the existing Supabase project (Dashboard access, to fetch a fresh service_role key)
Access to the domain/DNS provider for gyftr.net
Basic familiarity with terminal commands
Estimated Setup Time
Approximately 3–4 hours, assuming all required AWS and DNS access is already available.

6. Step 1 — Clone & Install the Project
Open a terminal and run:
git clone https://github.com/yashtahlyani/Gyftr-Tech-portal
cd Gyftr-Tech-portal

npm install

cd backend
npm install
cd ..

cd scripts/aws-migration
npm install
cd ../..

This installs dependencies for:
Frontend
Backend
Migration and setup scripts

7. Step 2 — Create PostgreSQL Database on AWS RDS
AWS RDS will become the primary production database for the portal.
Create the RDS Instance
Open:
AWS Console → RDS → Create Database
Use the following configuration:
Creation Method: Standard Create
Engine: PostgreSQL
PostgreSQL Version: 16
Template: Dev/Test for initial testing, or Production if you want Multi-AZ (not required at this traffic level)
DB Instance Identifier: gyftr-tech-portal
Master Username: gyftr_admin
Instance Type: db.t4g.micro
Storage: 20 GB gp3
Create a strong database password and store it securely (you'll put it into Secrets Manager in Step 3, not in any file).
Connectivity
Public Access: No — this app's whole security model depends on the database being reachable only from the backend, never directly from the internet or your laptop. If you need to run the migration scripts from your own machine, tunnel through the EC2 instance created in Step 7 (or run the migration scripts on the EC2 box itself) rather than opening RDS to the public.
Create a security group named:
gyftr-rds-sg — leave it with no inbound rules for now; you'll open port 5432 to the EC2 security group once it exists (Step 7).
Additional configuration → initial database name: gyftr_tech_portal
Click Create Database.
Provisioning generally takes approximately 5–10 minutes.
Save the RDS Endpoint
Once the database is available:
RDS → Databases → gyftr-tech-portal → Connectivity & Security
Copy the database endpoint.
Example:
gyftr-tech-portal.xxxx.ap-south-1.rds.amazonaws.com

8. Create the Database Schema
Connect to PostgreSQL (from the EC2 box or via a tunnel, since public access is off):
psql "postgresql://gyftr_admin:YOUR_PASSWORD@YOUR_RDS_ENDPOINT:5432/gyftr_tech_portal"

Once connected, run the full contents of backend/db/schema.sql from the repo:
\i backend/db/schema.sql

Or paste it directly — the complete schema is reproduced here for convenience:

create type team_id  as enum ('business','product','tech_spoc','development','design','qa','partner','leadership');
create type role_id  as enum ('member','lead','pmo','leadership');
create type stage_id as enum ('intake','scoping','to_be_picked','development','qa','uat','pre_prod','live');
create type priority as enum ('P0','P1','P2');

create table people (
  id          uuid primary key default gen_random_uuid(),
  cognito_sub text unique,
  name        text not null,
  email       text unique not null,
  team        team_id not null,
  role        role_id not null default 'member'
);

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

create extension if not exists pgcrypto;

Exit PostgreSQL using:
\q

9. Step 3 — Configure AWS Secrets Manager
AWS Secrets Manager stores database credentials securely so that they do not need to be hardcoded into the backend.
Open:
AWS Console → Secrets Manager → Store a New Secret
Choose:
Secret Type: Credentials for Amazon RDS database
Select the gyftr-tech-portal RDS instance and enter the master username/password from Step 7 — AWS auto-populates the secret with the right keys (host, port, dbname, username, password), which is exactly what backend/db.js and the migration scripts expect.
Set the secret name to:
gyftr-tech-portal/rds
Complete the creation process.

10. Step 4 — Configure AWS Cognito
AWS Cognito handles authentication and replaces the existing Supabase authentication system.
Open:
AWS Console → Cognito → Create User Pool
Configure:
Sign-in Option: Email
Password Policy: Default
MFA: Disabled
Self-registration: Disabled — every account is created ahead of time by scripts/aws-migration/create-cognito-users.mjs; nobody signs themselves up
Account Recovery: Default
Set:
User Pool Name: gyftr-tech-portal
App Client Name: gyftr-tech-portal-web
Client Type: Public Client
Client Secret: Do not generate (the SPA can't keep a secret)
Important: under the app client's Authentication flows, enable both ALLOW_USER_SRP_AUTH (used by the actual frontend login) and ALLOW_ADMIN_USER_PASSWORD_AUTH (needed by create-cognito-users.mjs's verification step and scripts/aws-migration/smoke-test.mjs).
Create the user pool.
Save the Following Values
After creation, copy:
User Pool ID
Example:
ap-south-1_AbcXYZ
Then open:
App Clients
Copy the:
Client ID
Both values are required for the frontend and backend configuration.

11. Step 5 — Create Cognito User Accounts
scripts/aws-migration/create-cognito-users.mjs creates a Cognito login for every real person already sitting in the people table (run this after Step 12's data migration, not before — it reads live people, not a hardcoded list), and links each one back via people.cognito_sub, which the backend uses to resolve a login to a person on every request.
Every account gets the same permanent password (default@123) — this is what powers the app's one-click profile picker; there is intentionally no per-user password here.
Create AWS Credentials
Open:
AWS Console → IAM → Users
Create a deployment/migration user and grant only the permissions required to manage Cognito users (cognito-idp:AdminCreateUser, cognito-idp:AdminSetUserPassword, cognito-idp:AdminGetUser) plus Secrets Manager read access if using AWS_SECRET_NAME.
Generate temporary access credentials for the setup process.
Mac/Linux
cd scripts/aws-migration
cp .env.example .env
# edit .env: COGNITO_USER_POOL_ID, COGNITO_REGION, AWS_SECRET_NAME (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE)

export AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY

node create-cognito-users.mjs

Windows Command Prompt
cd scripts\aws-migration
copy .env.example .env
rem edit .env: COGNITO_USER_POOL_ID, COGNITO_REGION, AWS_SECRET_NAME (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE)

set AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
set AWS_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY

node create-cognito-users.mjs

The terminal displays created/skipped/failed for every person — safe to re-run any time (existing Cognito users are skipped, not recreated; cognito_sub is re-linked either way).
After completing setup, remove or deactivate temporary IAM credentials that are no longer required.

12. Step 6 — Migrate Supabase Data to AWS RDS
scripts/aws-migration/migrate-db.mjs transfers every table — people, projects, subtasks, stage_targets, stage_history, comments, attachments — from Supabase to RDS, preserving every row's original ID so foreign keys still resolve correctly. Safe to re-run (ON CONFLICT DO NOTHING).
Run this before Step 11 (create-cognito-users.mjs needs the people rows to already be in RDS).
Mac/Linux
cd scripts/aws-migration
cp .env.example .env
# edit .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AWS_SECRET_NAME (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE)

node migrate-db.mjs

Windows Command Prompt
cd scripts\aws-migration
copy .env.example .env
rem edit .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AWS_SECRET_NAME (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE)

node migrate-db.mjs

Wait until the script confirms:
Done. Next: run create-cognito-users.mjs to create logins and link them to these people rows.
Verify Migration
Connect to RDS and execute:
SELECT COUNT(*) FROM projects;
SELECT COUNT(*) FROM people;

Both should return a value greater than 0. It's worth spot-checking subtasks, comments, and stage_history counts too before treating Supabase as decommissioned.

13. Step 7 — Deploy Backend on AWS EC2
The Express API will run on an EC2 instance.
Open:
AWS Console → EC2 → Launch Instance
Configure:
Name: gyftr-tech-portal-api
AMI: Amazon Linux 2023
Instance Type: t4g.micro (or t3.micro if not using Graviton)
Key Pair
Create:
gyftr-tech-portal-key
Download the .pem file and store it securely. The private key cannot be downloaded again after creation.
Security Group
Create:
gyftr-api-sg
Initially, temporarily allow your own IP on port 4000 for testing. Once the ALB exists (Step 14), come back and restrict inbound 4000 to the ALB's security group only, and remove the temporary rule.
Allow SSH (22) only from trusted administrator IP addresses.
IAM Role
Create an EC2 IAM role:
gyftr-tech-portal-ec2-role
Grant it permission to read the gyftr-tech-portal/rds secret from AWS Secrets Manager (secretsmanager:GetSecretValue, scoped to that one secret's ARN).
Once the instance is running, go back to gyftr-rds-sg (RDS's security group, Step 7) and add an inbound rule: PostgreSQL (5432) from gyftr-api-sg.

14. Connect to EC2
Connect using SSH:
chmod 400 gyftr-tech-portal-key.pem

ssh -i gyftr-tech-portal-key.pem ec2-user@YOUR_EC2_PUBLIC_IP

After connecting:
# Install Node.js
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs git

# Clone the repository
git clone https://github.com/yashtahlyani/Gyftr-Tech-portal /app/gyftr-tech-portal

cd /app/gyftr-tech-portal/backend

npm ci --omit=dev

15. Configure Backend Environment
Inside:
/app/gyftr-tech-portal/backend
Create .env:
cat > .env << 'EOF'
PORT=4000
AWS_SECRET_NAME=gyftr-tech-portal/rds
COGNITO_USER_POOL_ID=YOUR_COGNITO_USER_POOL_ID
COGNITO_CLIENT_ID=YOUR_COGNITO_CLIENT_ID
COGNITO_REGION=ap-south-1
FRONTEND_URL=https://techportal.gyftr.net
EOF

16. Configure PM2
PM2 keeps the Node.js backend running continuously.
Install PM2:
sudo npm install -g pm2

Start the backend:
pm2 start server.js --name gyftr-api
pm2 startup
pm2 save

Check status:
pm2 status

For initial testing, access:
http://YOUR_EC2_IP:4000/health

A healthy API should return:
{"ok":true}

17. Step 8 — Configure HTTPS with AWS ALB
The frontend must communicate with the backend through HTTPS.
The suggested production API URL is:
https://techportal-api.gyftr.net
(pick any subdomain you like — just make sure it doesn't collide with any other app already using gyftr.net, and update FRONTEND_URL/VITE_API_URL to match whatever you choose)
Create SSL Certificate
Open:
AWS Console → Certificate Manager → Request Certificate
Request a certificate for:
techportal-api.gyftr.net
Validate ownership using DNS.
Add the CNAME validation record provided by AWS to the DNS provider.
Create Application Load Balancer
Open:
EC2 → Load Balancers → Create Load Balancer → Application Load Balancer
Configure:
Name: gyftr-api-alb
Scheme: Internet-facing
HTTPS Listener: Port 443
Attach the ACM certificate created for techportal-api.gyftr.net
Target Group
Create a target group:
Target Type: Instances
Backend Port: 4000
Health check path: /health
Register the EC2 instance.
After the ALB is created, copy its DNS name.
Example:
gyftr-api-alb.xxxx.elb.amazonaws.com
DNS Configuration
Create:
techportal-api.gyftr.net
        ↓
Application Load Balancer
        ↓
EC2 Backend :4000

Add the appropriate DNS record pointing techportal-api.gyftr.net to the ALB.

18. Step 9 — Deploy Frontend with S3 & CloudFront
The suggested production frontend URL is:
https://techportal.gyftr.net
Configure Frontend Environment
Inside the repo root, create .env:
VITE_API_URL=https://techportal-api.gyftr.net
VITE_COGNITO_USER_POOL_ID=YOUR_COGNITO_USER_POOL_ID
VITE_COGNITO_CLIENT_ID=YOUR_COGNITO_CLIENT_ID

Build the frontend:
npm ci
npm run build

This generates:
dist/

19. Create the S3 Bucket
Open:
AWS Console → S3 → Create Bucket
Configure:
Bucket Name: gyftr-tech-portal-web (bucket names are global — pick something unique if taken)
Region: ap-south-1
Block all public access — CloudFront will reach it via Origin Access Control, not a public bucket policy.
Upload the build:
aws s3 sync dist/ s3://gyftr-tech-portal-web/ --delete

20. Configure CloudFront
Open:
AWS Console → CloudFront → Create Distribution
Origin
Select:
gyftr-tech-portal-web.s3.ap-south-1.amazonaws.com
Configure:
Origin Access: Origin Access Control (OAC)
Create a new OAC and apply the generated S3 bucket policy.
Viewer Configuration
Set:
Viewer Protocol Policy: Redirect HTTP to HTTPS
Default Root Object: index.html
SPA Routing
Not needed for this app — unlike a typical React app, it has no client-side router (no react-router; navigation is in-memory state, not URL-based), so there are no deep-link routes that need a 404→index.html rewrite. Skip this step entirely.
Custom Domain
Add:
techportal.gyftr.net
Attach an ACM certificate covering the domain — must be requested in us-east-1 specifically; CloudFront only accepts certs from that region regardless of where everything else lives.
Create the distribution and copy its CloudFront domain name.
DNS
Point:
techportal.gyftr.net
        ↓
CloudFront
        ↓
S3 Frontend

21. Step 10 — Production Testing
Once deployment is complete, open:
https://techportal.gyftr.net
Perform the following checks:
Authentication
Verify that clicking any real person's name signs in successfully.
Verify each person lands on the right home view (PMO/Leadership → Dashboard; everyone else → My Queue).
Leadership
Log in as leadership@gyftr.net.
Confirm:
Every project is visible, across every team.
No edit controls are active anywhere — leadership can only leave comments.
The attachment-upload form does not appear on projects leadership's team isn't yet part of.
PMO
Log in as rajneesh@gyftr.net or pmo@gyftr.net.
Confirm:
Every project is visible and actionable regardless of which team holds court.
Transitions, status changes, blocking, reassigning, and subtask management all work.
Ordinary Team Member
Log in as a Business/Product/Tech SPOC/Development/Design/QA member.
Confirm:
Only projects their team is or has been involved in are visible.
They can only act on a project while their team currently holds it.
Sub-task create/manage buttons only appear for Product/Tech SPOC/PMO — everyone else can still toggle a sub-task assigned to them, but can't reassign/remove/retarget it.
Additional Verification
Test:
Creating a new project
Moving a project through a full stage transition (e.g. Submit to Product)
Picking up a project from "To Be Picked"
Setting a stage's expected date, and confirming it's rejected out of sequence
Adding/removing/reassigning a sub-task
Posting a comment and pinning/resolving a leadership note
Attaching a document
Blocking and unblocking a project
Dashboard totals and the Escalations view
Logging out and back in as a different person
Refreshing the page mid-session
Once these checks pass, the AWS deployment can be considered live.

22. Deployment Architecture
The production architecture should be:
User
  ↓
techportal.gyftr.net
  ↓
CloudFront
  ↓
S3 — React Frontend
  ↓
techportal-api.gyftr.net
  ↓
Application Load Balancer
  ↓
EC2 — Express Backend
  ↓
AWS RDS — PostgreSQL

Authentication is handled separately through:
Frontend / Backend
        ↓
AWS Cognito

Database credentials are provided securely through:
EC2 Backend
     ↓
AWS Secrets Manager
     ↓
RDS Credentials

23. Deploying Future Updates
Frontend Updates
When frontend code changes:
git pull
npm install
npm run build

aws s3 sync dist/ s3://gyftr-tech-portal-web/ --delete

Invalidate the CloudFront cache:
aws cloudfront create-invalidation \
  --distribution-id YOUR_CF_DISTRIBUTION_ID \
  --paths "/*"

The updated frontend should become available after the invalidation completes.

24. Backend Updates
Connect to EC2:
ssh -i gyftr-tech-portal-key.pem ec2-user@YOUR_EC2_PUBLIC_IP

Then:
cd /app/gyftr-tech-portal

git pull

cd backend
npm ci --omit=dev

pm2 restart gyftr-api

Verify:
pm2 status

If necessary:
pm2 logs gyftr-api

25. Common Administrative Changes
Add a New Team Member
Unlike apps that hardcode role/email mappings in the frontend, this app is entirely database-driven — nobody's team or role lives in source code, so there is no file to edit and no redeploy needed.
Step 1 — Add the person to RDS
insert into people (name, email, team, role)
values ('Full Name', 'first.last@gyftr.net', 'business', 'member');

(team must be one of: business, product, tech_spoc, development, design, qa, partner, leadership. role must be one of: member, lead, pmo, leadership.)
Step 2 — Create their Cognito login
cd scripts/aws-migration
node create-cognito-users.mjs

This only creates logins for people who don't already have one, so it's safe to run any time — no need to touch anyone else's account.
That's it — they'll appear in the app's profile picker on next page load, no rebuild or redeploy required.

26. Add a New Partner / Brand
Nothing to do here — Partner and Brand are free-text fields with a "pick existing or type a new one" input on the Create Project form (populated from whatever partners/brands already exist across current projects). No static list, no code change, no redeploy.

27. Reset / Change a Password
This app deliberately does not use per-user passwords — every account shares default@123 so the one-click profile picker works for everyone, and the frontend always authenticates with that same shared password no matter whose name is clicked (see src/auth.ts's DEMO_PASSWORD).
If you want a genuinely different password for one specific person, you can set it via:
AWS Console → Cognito → User Pool → Users → [pick the user] → Actions → Reset Password
— but be aware this will break that one person's one-click login, since the app will still try to sign them in with default@123 and fail. Don't do this unless you're also ready to move that person (or the whole app) to a real typed-password login form, which is a real follow-up project, not a quick toggle.

28. Troubleshooting
Frontend Shows a Blank Page
Open browser Developer Tools using F12 and check the Console.
Verify the frontend environment variables:
VITE_API_URL
VITE_COGNITO_USER_POOL_ID
VITE_COGNITO_CLIENT_ID
Incorrect environment variables are a common cause of frontend startup failures — remember they're baked in at build time, so a `.env` edit needs a rebuild + redeploy, not just a server restart.
Login Fails
Open:
AWS Console → Cognito → User Pool → Users
Verify:
User exists
Email is correct and ends in @gyftr.net
Account status is CONFIRMED
Cognito User Pool ID / Client ID in the frontend's .env match what's actually in Cognito
Login Succeeds But Shows "No Portal Access"
That Cognito account exists but isn't linked to a people row (people.cognito_sub is null or stale). Re-run node scripts/aws-migration/create-cognito-users.mjs, or check the person actually has a row in people at all.
Projects Are Not Loading
Check whether the backend is running.
SSH into EC2 and execute:
pm2 status

If gyftr-api is stopped or errored:
pm2 logs gyftr-api

Restart if necessary:
pm2 restart gyftr-api

Backend Cannot Connect to Database
Check:
RDS instance is running.
EC2 has network access to RDS.
gyftr-rds-sg permits PostgreSQL traffic (5432) from gyftr-api-sg.
Secrets Manager's gyftr-tech-portal/rds secret contains the correct database credentials.
EC2's IAM role can read that secret.
CloudFront Shows an Old Version
Create a cache invalidation:
aws cloudfront create-invalidation \
  --distribution-id YOUR_CF_DISTRIBUTION_ID \
  --paths "/*"

Backend API Is Not Accessible
Check:
pm2 status
pm2 logs gyftr-api

Then verify:
EC2 instance is running.
ALB target is healthy (health check hits /health).
Target group uses port 4000.
HTTPS listener is configured with a valid ACM certificate.
DNS for techportal-api.gyftr.net points to the correct ALB.
Nobody Sees a Teammate's Change Immediately
Expected — this app polls for updates every ~7 seconds rather than pushing changes instantly (the old Supabase version had instant push via Realtime; this was a deliberate simplification for the AWS rebuild, since instant push would need extra infrastructure — WebSockets or similar). If this turns out to matter in practice, it's a real follow-up project, not a quick fix.

29. Post-Migration Security Checklist
After confirming that the AWS version works correctly:
Verify all Supabase data has migrated successfully.
Compare record counts between Supabase and RDS (people, projects, subtasks, comments, attachments, stage_history, stage_targets).
Test major portal functionality per Section 21.
Rotate/revoke the Supabase service_role key used for migration.
Rotate any Supabase personal access token that was ever pasted into chat, a ticket, or a doc during this project — treat those as already compromised regardless of whether they were "meant" to be temporary.
Remove unnecessary AWS access keys and temporary IAM permissions.
Confirm RDS has no public access, and is reachable only from gyftr-api-sg.
Confirm EC2's application port (4000) is reachable only from the ALB's security group, not the open internet.
Keep the S3 frontend bucket private behind CloudFront OAC.
Confirm HTTPS is enforced on both the frontend and API domains.
Confirm .env files are excluded from Git (they are, by default — check with git check-ignore backend/.env .env if unsure).
Confirm no passwords or API keys are hardcoded anywhere in the committed source (a full-repo secret scan was already run before this code was pushed, but re-check after any future changes).

30. Final Go-Live Checklist
Before declaring the migration complete, confirm:
Infrastructure
RDS PostgreSQL is running, schema loaded.
Cognito user pool is configured with both required auth flows enabled.
All 21 real people have Cognito logins, linked via cognito_sub.
EC2 backend is running and pm2 status shows it healthy.
Application Load Balancer target is healthy.
S3 frontend is deployed.
CloudFront distribution is active.
SSL certificates are valid on both domains.
DNS records resolve correctly.
Application
Login works for every role (PMO, Leadership, ordinary member).
Projects and their full history/comments/subtasks/attachments loaded from Supabase are all present.
A brand-new project can be created end-to-end.
A full stage transition (Intake → Live) can be walked through by the right people at each step.
Sub-task permissions match Section 21's checks exactly.
Stage-date sequencing is enforced.
Dashboard and Escalations views show correct data.
Security
Temporary AWS credentials have been removed.
Supabase service_role key has been rotated.
RDS is not publicly reachable.
EC2's API port is restricted to the ALB.
Production credentials are stored in Secrets Manager / environment variables, not in the repo.
Once all items above have been verified, the migration and production handover are complete.

31. Quick Reference
Production Frontend
https://techportal.gyftr.net (suggested — confirm with whoever owns gyftr.net's DNS)
Production API
https://techportal-api.gyftr.net (suggested)
Git Repository
https://github.com/yashtahlyani/Gyftr-Tech-portal
AWS Region
ap-south-1 (suggested — pick whatever's closest to your users)
RDS Database
gyftr-tech-portal
Database User
gyftr_admin
Cognito User Pool
gyftr-tech-portal
Cognito App Client
gyftr-tech-portal-web
EC2 Instance
gyftr-tech-portal-api
Backend PM2 Process
gyftr-api
Secrets Manager Secret
gyftr-tech-portal/rds
Frontend S3 Bucket
gyftr-tech-portal-web
Frontend Domain
techportal.gyftr.net (suggested)
Backend Domain
techportal-api.gyftr.net (suggested)

32. Handover Notes
The application has been structured so that the AWS deployment replaces the previous Supabase-based infrastructure while retaining the existing portal functionality and historical data. Every authorization rule that used to live in Supabase's Row-Level Security policies has been ported 1:1 into backend/authz.js — if you ever need to change who's allowed to do what, that's the one file to look at (its comments cite exactly which old policy each function replaces).
The most important responsibilities for the new maintainer are:
Keep production credentials secure.
Verify RDS backups are enabled and tested.
Test role-based access whenever people are added or their team/role changes.
Deploy frontend changes through S3 and CloudFront.
Deploy backend changes through EC2 and PM2.
Monitor backend logs (pm2 logs gyftr-api) when API issues occur.
Keep AWS permissions limited to what each service actually requires.
Maintain the GitHub repository as the single source of truth for application code.
Do not delete or permanently disable the old Supabase project until the migrated AWS system has been thoroughly tested and the migrated data has been verified against it.

Contact
Built & Handed Over By:
Yash Tahlyani
Email:
yash.tahlyani@gyftr.net
Project:
Gyftr Tech Portal
