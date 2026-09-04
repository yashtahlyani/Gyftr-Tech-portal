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
Backend Hosting: AWS ECS/Fargate (behind an Application Load Balancer), built by CodeBuild from a Docker image — same mechanism as the sibling gyftr-portal/gyftr-legal apps, not a hand-managed EC2 box
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
The backend API runs as a Docker container on ECS/Fargate behind an Application Load Balancer, built and deployed by CodeBuild/CodePipeline from backend/Dockerfile — matching how the sibling gyftr-portal and gyftr-legal apps actually deploy (their infra docs originally described EC2+pm2 too, but that was superseded early on; this doc starts from the real, proven mechanism instead of repeating that detour).
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
AWS CLI, configured with credentials that can manage RDS/Cognito/ECS/ECR/CodeBuild/CodePipeline/S3/CloudFront/Secrets Manager/IAM
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
Public Access: No — this app's whole security model depends on the database being reachable only from the backend, never directly from the internet or your laptop. Run the migration scripts from inside the VPC (an ECS `exec` session, a bastion, or a temporary Cloud9/EC2 box in the same VPC) rather than opening RDS to the public.
Create a security group named:
gyftr-tech-portal-rds-sg — leave it with no inbound rules for now; you'll open port 5432 to the backend ECS service's security group once it exists.
Additional configuration → initial database name: gyftr_tech_portal
Click Create Database.
Provisioning generally takes approximately 5–10 minutes.
Save the RDS Endpoint
Once the database is available:
RDS → Databases → gyftr-tech-portal → Connectivity & Security
Copy the database endpoint.
Example:
gyftr-tech-portal.xxxx.ap-south-1.rds.amazonaws.com

8. Database Schema — applies itself automatically
Unlike a typical app, there's no manual `psql -f schema.sql` step to run. backend/db.js's `applySchema()` executes the full contents of backend/db/schema.sql against RDS on every single API boot — every statement in that file is written to be safely re-runnable (`create table if not exists`, a `do $$ ... exception when duplicate_object$$` guard around the enum types, etc.), so the schema is always current the moment the backend container starts for the first time. This is the same convention the sibling gyftr-portal/gyftr-legal backends use: deploying = restarting a container, never a separate migration step to forget.
If you ever do need to inspect or hand-apply it (e.g. to poke at the database directly before the API has ever run), the file to read is backend/db/schema.sql in the repo — it's the single source of truth, not reproduced inline here so this doc can't silently drift out of sync with it.

9. Step 3 — Configure AWS Secrets Manager
AWS Secrets Manager stores database credentials securely so that they do not need to be hardcoded into the backend.
Open:
AWS Console → Secrets Manager → Store a New Secret
Choose:
Secret Type: Credentials for Amazon RDS database
Select the gyftr-tech-portal RDS instance and enter the master username/password from Step 7 — AWS auto-populates the secret with the right keys (host, port, dbname, username, password), which is exactly what backend/db.js and the migration scripts expect.
Set the secret name to:
gyftr/tech-portal/db — slash-separated, matching the sibling apps' gyftr/portal/db and gyftr/legal/db naming (not a hyphenated variant).
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
User Pool Name: gyftr-tech-portal-users (matches the sibling apps' gyftr-portal-users / gyftr-legal-users naming)
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
# edit .env: COGNITO_USER_POOL_ID, COGNITO_REGION, AWS_SECRET_NAME (or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME)

export AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY

node create-cognito-users.mjs

Windows Command Prompt
cd scripts\aws-migration
copy .env.example .env
rem edit .env: COGNITO_USER_POOL_ID, COGNITO_REGION, AWS_SECRET_NAME (or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME)

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
# edit .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AWS_SECRET_NAME (or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME)

node migrate-db.mjs

Windows Command Prompt
cd scripts\aws-migration
copy .env.example .env
rem edit .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AWS_SECRET_NAME (or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME)

node migrate-db.mjs

Wait until the script confirms:
Done. Next: run create-cognito-users.mjs to create logins and link them to these people rows.
Verify Migration
Connect to RDS and execute:
SELECT COUNT(*) FROM projects;
SELECT COUNT(*) FROM people;

Both should return a value greater than 0. It's worth spot-checking subtasks, comments, and stage_history counts too before treating Supabase as decommissioned.

13. Step 7 — ECR repositories
CodeBuild pushes Docker images here; ECS pulls from here. Two repos, one per side:
aws ecr create-repository --repository-name gyftr-tech-portal-backend --region ap-south-1
aws ecr create-repository --repository-name gyftr-tech-portal-frontend --region ap-south-1

14. Step 8 — ECS cluster, task definitions, services
The Express API and (optionally — see Step 9's two options) the frontend both run as Docker containers on ECS/Fargate, not a hand-managed EC2 box. This matches how gyftr-portal and gyftr-legal actually run in production.
ECS console → Create cluster → "Networking only" (Fargate), name gyftr-tech-portal.
Backend task definition: Fargate, ARM64 (matches backend/Dockerfile's --platform linux/arm64), 0.5 vCPU / 1GB to start. Container image <account>.dkr.ecr.ap-south-1.amazonaws.com/gyftr-tech-portal-backend:latest, port 4000. Environment variables: AWS_SECRET_NAME=gyftr/tech-portal/db, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_REGION=ap-south-1, FRONTEND_URL, NODE_ENV=production.
Task execution role needs secretsmanager:GetSecretValue scoped to the gyftr/tech-portal/db secret's ARN, plus standard ECR pull permissions.
Security group gyftr-tech-portal-backend-sg: accepts port 4000 from the ALB's security group only (created in Step 17).
Create an ECS service from this task definition, desired count 1 to start, attached to the backend ALB target group (Step 17) — ECS keeps the target group's registered targets in sync with running tasks automatically; there's no manual "register instance" step like there would be with EC2.
Once the service exists, go back to gyftr-tech-portal-rds-sg (RDS's security group, Step 7) and add an inbound rule: PostgreSQL (5432) from gyftr-tech-portal-backend-sg.

15. Step 9 — Frontend hosting: two valid options
Pick whichever your infra team prefers — both are proven patterns from the sibling apps.
Option A — S3 + CloudFront (simpler/cheaper): build the frontend (locally or in CI) with the right VITE_* env vars baked in, aws s3 sync dist/ s3://<bucket> --delete, serve via CloudFront with an Origin Access Control. This app has no client-side router (no react-router; navigation is in-memory state, not URL-based), so there's no 404→index.html rewrite rule to configure, unlike a typical SPA.
Option B — ECS, same as the backend: build the frontend Docker image (root Dockerfile, buildspec.yml) via CodeBuild, run it as a second ECS service (task port 4173), behind its own ALB (or an extra listener rule on the backend's ALB). This is what the repo's Docker/buildspec files are set up for by default.
Configure Frontend Build-Time Env
Whichever option: the frontend needs VITE_API_URL, VITE_COGNITO_USER_POOL_ID, VITE_COGNITO_CLIENT_ID baked in at build time (Vite inlines these into the JS bundle — they can't be changed after the fact without rebuilding):
VITE_API_URL=https://techportal-api.gyftr.net
VITE_COGNITO_USER_POOL_ID=YOUR_COGNITO_USER_POOL_ID
VITE_COGNITO_CLIENT_ID=YOUR_COGNITO_CLIENT_ID

npm ci
npm run build

This generates dist/ (Option A) or is what Dockerfile's build stage does automatically via --build-arg (Option B).

16. Step 10 — CodeBuild + CodePipeline
Create two CodeBuild projects: gyftr-tech-portal-backend-build (buildspec path backend/buildspec.yml) and gyftr-tech-portal-frontend-build (buildspec path buildspec.yml at repo root).
Both need Privileged mode ON (Docker-in-Docker), ARM/Graviton compute, and an IAM role with ECR push permissions (plus sts:GetCallerIdentity for the frontend project).
Frontend project additionally needs VITE_COGNITO_USER_POOL_ID, VITE_COGNITO_CLIENT_ID, VITE_API_URL, and FRONTEND_ECS_CONTAINER (the container name in the frontend task definition) as CodeBuild environment variables.
Wire each into a CodePipeline: Source (this GitHub repo, main branch) → Build (matching CodeBuild project) → Deploy (ECS deploy action, pointed at the matching cluster/service, consuming the imagedefinitions.json artifact).

17. Step 11 — ALB for the backend
Request a certificate: ACM console → Request a public certificate for techportal-api.gyftr.net → DNS validation → add the CNAME record ACM gives you to your DNS provider → wait for "Issued".
EC2 console → Load Balancers → Create → Application Load Balancer. Name gyftr-tech-portal-api-alb, internet-facing, the two public subnets from Step 1.
Security group: allow inbound 443 from 0.0.0.0/0.
Listener: HTTPS:443, attach the ACM certificate.
Target group: gyftr-tech-portal-api-tg, target type IP (required for Fargate — not Instance, unlike an EC2 setup), protocol HTTP, port 4000, health check path /health.
Point the ECS backend service at this target group when creating it (Step 14) rather than registering targets manually.
Point techportal-api.gyftr.net's DNS (A/ALIAS record) at the ALB's DNS name.
(If you chose Option B for the frontend in Step 15, repeat this step for it too — separate ALB or an extra listener rule, target group port 4173, health check path /.)

18. Step 10 — Production Testing
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

19. Deployment Architecture
The production architecture (Option A frontend — S3+CloudFront):
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
ECS/Fargate — Express Backend (Docker container, built by CodeBuild)
  ↓
AWS RDS — PostgreSQL

(Option B — ECS frontend instead of S3+CloudFront: the frontend row becomes its own ALB → ECS/Fargate → Docker container, same shape as the backend.)

Authentication is handled separately through:
Frontend / Backend
        ↓
AWS Cognito

Database credentials are provided securely through:
ECS Task (Backend)
     ↓
AWS Secrets Manager
     ↓
RDS Credentials

20. Deploying Future Updates
Push to main and CodePipeline handles the rest automatically — no SSH, no manual pm2 restart, no manual Docker build:
git push origin main
→ CodePipeline detects the push
→ CodeBuild builds and pushes a new Docker image to ECR (backend/buildspec.yml or buildspec.yml depending which side changed)
→ ECS deploy action rolls the corresponding service to the new image (rolling deployment — brief overlap, no downtime)

If you went with Option A for the frontend (S3+CloudFront, not ECS), that side deploys the old-fashioned way instead — either manually or via its own small CI step:
npm run build
aws s3 sync dist/ s3://gyftr-tech-portal-web/ --delete
aws cloudfront create-invalidation --distribution-id YOUR_CF_DISTRIBUTION_ID --paths "/*"

To force a one-off redeploy without a code change (e.g. after rotating a secret, so the running task picks up the new value):
aws ecs update-service --cluster gyftr-tech-portal --service <backend-service-name> --force-new-deployment

To check deploy status or investigate a stuck rollout:
aws ecs describe-services --cluster gyftr-tech-portal --services <service-name>

21. Common Administrative Changes
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

22. Add a New Partner / Brand
Nothing to do here — Partner and Brand are free-text fields with a "pick existing or type a new one" input on the Create Project form (populated from whatever partners/brands already exist across current projects). No static list, no code change, no redeploy.

23. Reset / Change a Password
This app deliberately does not use per-user passwords — every account shares default@123 so the one-click profile picker works for everyone, and the frontend always authenticates with that same shared password no matter whose name is clicked (see src/auth.ts's DEMO_PASSWORD).
If you want a genuinely different password for one specific person, you can set it via:
AWS Console → Cognito → User Pool → Users → [pick the user] → Actions → Reset Password
— but be aware this will break that one person's one-click login, since the app will still try to sign them in with default@123 and fail. Don't do this unless you're also ready to move that person (or the whole app) to a real typed-password login form, which is a real follow-up project, not a quick toggle.

24. Troubleshooting
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
Check whether the backend task is running and healthy:
aws ecs describe-services --cluster gyftr-tech-portal --services <backend-service-name>

If tasks are stuck/crash-looping, check the logs:
aws logs tail /ecs/gyftr-tech-portal-backend --follow

(Or in the console: ECS → cluster → service → Logs tab.) Also check GET <API_URL>/health/deep directly — it reports the real DB-readiness error if the process is up but can't reach RDS.

Backend Cannot Connect to Database
Check:
RDS instance is running.
The backend ECS service's security group has a path to RDS.
gyftr-tech-portal-rds-sg permits PostgreSQL traffic (5432) from the backend service's security group.
Secrets Manager's gyftr/tech-portal/db secret contains the correct database credentials.
The ECS task execution role can read that secret (secretsmanager:GetSecretValue on its ARN).
CloudFront Shows an Old Version
Create a cache invalidation:
aws cloudfront create-invalidation \
  --distribution-id YOUR_CF_DISTRIBUTION_ID \
  --paths "/*"

(Only relevant if you went with Option A — S3+CloudFront — for the frontend.)
Backend API Is Not Accessible
Check:
aws ecs describe-services --cluster gyftr-tech-portal --services <backend-service-name>
aws logs tail /ecs/gyftr-tech-portal-backend --follow

Then verify:
ECS service's desired count matches its running count (a mismatch means tasks are failing to start or failing health checks and getting cycled).
ALB target is healthy (health check hits /health).
Target group uses port 4000 and target type IP (not Instance — a common misconfiguration when following EC2-era instructions by habit).
HTTPS listener is configured with a valid ACM certificate.
DNS for techportal-api.gyftr.net points to the correct ALB.
scripts/aws-migration/doctor.js walks through all of the above automatically — run it first before working through this list by hand.
Nobody Sees a Teammate's Change Immediately
Expected — this app polls for updates every ~7 seconds rather than pushing changes instantly (the old Supabase version had instant push via Realtime; this was a deliberate simplification for the AWS rebuild, since instant push would need extra infrastructure — WebSockets or similar). If this turns out to matter in practice, it's a real follow-up project, not a quick fix.

25. Post-Migration Security Checklist
After confirming that the AWS version works correctly:
Verify all Supabase data has migrated successfully.
Compare record counts between Supabase and RDS (people, projects, subtasks, comments, attachments, stage_history, stage_targets).
Test major portal functionality per Section 21.
Rotate/revoke the Supabase service_role key used for migration.
Rotate any Supabase personal access token that was ever pasted into chat, a ticket, or a doc during this project — treat those as already compromised regardless of whether they were "meant" to be temporary.
Remove unnecessary AWS access keys and temporary IAM permissions.
Confirm RDS has no public access, and is reachable only from the backend ECS service's security group.
Confirm the backend's port (4000) is reachable only from the ALB's security group, not the open internet — a Fargate task has no SSH surface to worry about, but the security group still needs to be locked down the same way an EC2 instance's would.
Keep the S3 frontend bucket private behind CloudFront OAC.
Confirm HTTPS is enforced on both the frontend and API domains.
Confirm .env files are excluded from Git (they are, by default — check with git check-ignore backend/.env .env if unsure).
Confirm no passwords or API keys are hardcoded anywhere in the committed source (a full-repo secret scan was already run before this code was pushed, but re-check after any future changes).

26. Final Go-Live Checklist
Before declaring the migration complete, confirm:
Infrastructure
RDS PostgreSQL is running (schema applies itself automatically the moment the backend task first starts — nothing to load manually).
Cognito user pool is configured with both required auth flows enabled.
All 21 real people have Cognito logins, linked via cognito_sub.
Backend ECS service is running with running count = desired count, and GET /health/deep returns ok.
Application Load Balancer target is healthy.
Frontend is deployed (S3+CloudFront, or its own ECS service — whichever option was chosen).
CodePipeline has completed successfully for both sides at least once.
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
The backend's API port is restricted to the ALB's security group.
Production credentials are stored in Secrets Manager / ECS task environment variables, not in the repo or baked into any Docker image.
Once all items above have been verified, the migration and production handover are complete.

27. Quick Reference
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
gyftr-tech-portal-users
Cognito App Client
gyftr-tech-portal-web
ECS Cluster
gyftr-tech-portal
Backend ECR Repo
gyftr-tech-portal-backend
Frontend ECR Repo
gyftr-tech-portal-frontend
Secrets Manager Secret
gyftr/tech-portal/db
Frontend S3 Bucket (Option A only)
gyftr-tech-portal-web
Frontend Domain
techportal.gyftr.net (suggested)
Backend Domain
techportal-api.gyftr.net (suggested)

28. Handover Notes
The application has been structured so that the AWS deployment replaces the previous Supabase-based infrastructure while retaining the existing portal functionality and historical data. Every authorization rule that used to live in Supabase's Row-Level Security policies has been ported 1:1 into backend/authz.js — if you ever need to change who's allowed to do what, that's the one file to look at (its comments cite exactly which old policy each function replaces).
This deployment mechanism (Docker → CodeBuild → ECR → ECS/Fargate) and most of the naming conventions in this doc deliberately match the sibling gyftr-portal (Marketing) and gyftr-legal apps, which already run this exact way in production — when in doubt about how a step should actually work in practice, those two repos' Dockerfile/buildspec.yml/infra docs are a working reference, not just this document's word for it.
The most important responsibilities for the new maintainer are:
Keep production credentials secure.
Verify RDS backups are enabled and tested.
Test role-based access whenever people are added or their team/role changes.
Deploy changes by pushing to main — CodePipeline builds and rolls out both sides automatically (see Section 20). Don't SSH into anything or hand-restart a process; if a deploy seems stuck, check CodePipeline's execution history and the ECS service's event log before trying anything manual.
Monitor backend logs via CloudWatch Logs (aws logs tail /ecs/gyftr-tech-portal-backend --follow, or the ECS console's Logs tab) when API issues occur.
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
