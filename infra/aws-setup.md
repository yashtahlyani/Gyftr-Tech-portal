# AWS setup — Gyftr Tech Portal

Follow these in order, all in `ap-south-1` (Mumbai) — same region as the sibling `gyftr-portal` (Marketing) and `gyftr-legal` deployments, so this stays on one shared ECR base image and one region's worth of AWS conventions to remember.

**Architecture:** browser → CloudFront → S3 (or ECS, see note below) for the static frontend · browser → ALB (HTTPS) → **ECS/Fargate** running the Express API (built as a Docker image via CodeBuild, not a manually-managed EC2 box) → RDS Postgres (private, no public access). Cognito issues the tokens the frontend attaches to every API call; the API verifies them and looks up the caller in `people`.

This matches exactly how `gyftr-portal` and `gyftr-legal` are actually deployed — containers on ECS behind an ALB, built by CodeBuild from the `Dockerfile`/`buildspec.yml` files in this repo, not EC2+SSH+pm2. (An earlier draft of this doc described EC2+pm2; that's been superseded — the `Dockerfile`/`buildspec.yml` files are the source of truth if anything here ever seems to disagree with them.)

---

## 1. VPC / networking

Use the same VPC the other Gyftr AWS apps already run in if one exists — otherwise the default VPC is fine. You need:
- 2 public subnets (for the ALB) in different AZs
- 2 private subnets (for RDS) in different AZs — RDS requires a subnet group spanning 2+ AZs even for a single-AZ instance
- ECS tasks can run in the public subnets with a locked-down security group, or in private subnets with a NAT gateway — either is fine for this traffic level.

## 2. ECR repositories

CodeBuild pushes images here; ECS pulls from here.

```bash
aws ecr create-repository --repository-name gyftr-tech-portal-backend --region ap-south-1
aws ecr create-repository --repository-name gyftr-tech-portal-frontend --region ap-south-1
```

## 3. RDS (Postgres)

1. RDS console → **Create database** → Standard create → **PostgreSQL** (16.x).
2. Templates: **Dev/Test** (or Production if you want Multi-AZ — not required for this traffic level).
3. DB instance identifier: `gyftr-tech-portal`. Master username: `gyftr_admin`. Let RDS auto-generate the password, or set one — either way it goes into Secrets Manager next, never into a file.
4. Instance class: `db.t4g.micro` is plenty for this app's traffic.
5. Storage: 20 GB gp3.
6. Connectivity: same VPC as step 1, create a **new security group** named `gyftr-tech-portal-rds-sg` — **no inbound rules yet** (add one scoped to the ECS service's security group once it exists, step 6).
7. **Public access: No.** Authorization now lives entirely in the Express layer (`backend/authz.js`), not RLS — the API is the only thing that should ever be able to reach this database.
8. Additional configuration → initial database name: `gyftr_tech_portal`.
9. Create. Note the endpoint hostname once available (Databases → gyftr-tech-portal → Connectivity & security).

Schema is applied automatically by the API itself on every boot (`backend/db.js`'s `applySchema()`, idempotent — safe to run every deploy) — there's no separate manual `psql -f schema.sql` step to remember.

## 4. Secrets Manager

1. Secrets Manager console → **Store a new secret** → "Credentials for Amazon RDS database".
2. Username/password: the master credentials from step 3. Select the `gyftr-tech-portal` RDS instance.
3. Secret name: **`gyftr/tech-portal/db`** — matches the sibling apps' `gyftr/portal/db` / `gyftr/legal/db` naming (slash-separated, not hyphenated).
4. Finish.

## 5. Cognito

1. Cognito console → **Create user pool**.
2. Sign-in options: **Email**. Skip phone.
3. Password policy: default is fine — nobody types a password against this policy anyway, since accounts are admin-created with a fixed password, never self-signed-up.
4. MFA: off (internal tool, admin-created accounts).
5. **Self-registration: disable it.** All accounts are created by `scripts/aws-migration/create-cognito-users.mjs`.
6. Required attributes: email only.
7. User pool name: **`gyftr-tech-portal-users`** (matches sibling naming — `gyftr-portal-users`, `gyftr-legal-users`).
8. App client: name it `gyftr-tech-portal-web`, **public client (no secret)** — the SPA can't keep a secret.
9. **Important:** under the app client's Authentication flows, enable **`ALLOW_ADMIN_USER_PASSWORD_AUTH`** (needed by `create-cognito-users.mjs`'s verification step and `smoke-test.mjs`) alongside the default `ALLOW_USER_SRP_AUTH` (used by the actual frontend login).
10. Create. Note the **User pool ID** and **App client ID**.

## 6. ECS cluster, task definitions, and services

1. ECS console → **Create cluster** → "Networking only" (Fargate), name `gyftr-tech-portal`.
2. **Backend task definition**: Fargate, ARM64 (matches the Dockerfile's `--platform linux/arm64`), 0.5 vCPU / 1GB is plenty to start. Container: image `<account>.dkr.ecr.ap-south-1.amazonaws.com/gyftr-tech-portal-backend:latest`, port 4000, env vars `AWS_SECRET_NAME=gyftr/tech-portal/db`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_REGION=ap-south-1`, `FRONTEND_URL=<your frontend domain>`, `NODE_ENV=production`. Task execution role needs `secretsmanager:GetSecretValue` scoped to the `gyftr/tech-portal/db` secret's ARN, plus standard ECR pull permissions.
3. **Frontend task definition**: same pattern, image `gyftr-tech-portal-frontend:latest`, port 4173. (Cognito/API config is already baked into the image at build time via `--build-arg` — no runtime env vars needed for the frontend container.)
4. Security group for both services: backend accepts 4000 from the ALB's SG only; frontend accepts 4173 from the ALB's SG only (or from CloudFront if you front it that way instead — see step 8).
5. Create an ECS **service** for each task definition — `desired count: 1` to start, behind the ALB target groups from the next step.
6. Go back to `gyftr-tech-portal-rds-sg` (step 3) and add an inbound rule: PostgreSQL (5432) from the backend service's security group.

## 7. ALB (HTTPS in front of the backend)

1. Request a certificate: ACM console → **Request a public certificate** for your API's domain (e.g. `techportal-api.gyftr.net`) → DNS validation → add the CNAME record ACM gives you to your DNS provider → wait for "Issued".
2. EC2 console → **Load Balancers** → **Create** → Application Load Balancer. Name: `gyftr-tech-portal-api-alb`. Internet-facing. Same VPC, the two public subnets.
3. Security group: allow inbound 443 from `0.0.0.0/0`.
4. Listener: HTTPS:443, attach the ACM certificate.
5. Target group: `gyftr-tech-portal-api-tg`, target type **IP** (required for Fargate, not Instance), protocol HTTP, port 4000, health check path `/health`.
6. Point the ECS backend service at this target group when you create it (step 6.5) instead of registering targets manually — ECS keeps the target group in sync with running tasks automatically.
7. Point your API domain's DNS (A/ALIAS record) at the ALB's DNS name.

## 8. Frontend — S3+CloudFront, or ECS behind its own ALB

Two valid options, matching what the sibling apps actually do (check which one your infra team prefers before picking — both are proven):

**Option A — S3 + CloudFront** (simpler, cheaper, what the original version of this doc described): build locally or in CI, `aws s3 sync dist/ s3://<bucket> --delete`, serve via CloudFront with an Origin Access Control. This app has **no client-side router**, so unlike a typical SPA there's no need for a 404→index.html rewrite rule.

**Option B — ECS, same as the backend**: use the frontend task definition from step 6.3, a second ALB (or a second listener rule on the same one) with target group port 4173, health check `/` (the frontend's `serve` container answers any path). This is what the Docker/buildspec files in this repo are set up for by default.

Either way, request the frontend's ACM certificate **in `us-east-1`** if you go the CloudFront route (CloudFront only accepts certs from that region); ALB-fronted ECS uses the same `ap-south-1` cert as everything else.

## 9. CodeBuild + CodePipeline

1. Create two CodeBuild projects: `gyftr-tech-portal-backend-build` and `gyftr-tech-portal-frontend-build`, both pointed at this repo, buildspec path `backend/buildspec.yml` and `buildspec.yml` (root) respectively.
2. Both need: **Privileged mode ON** (Docker-in-Docker), an ARM/Graviton-capable compute type, and an IAM role with ECR push permissions plus (for the frontend project) `sts:GetCallerIdentity`.
3. Frontend project needs `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_API_URL`, and `FRONTEND_ECS_CONTAINER` (the container name in the frontend task definition — used to build `imagedefinitions.json`) as CodeBuild environment variables.
4. Wire each into a CodePipeline: Source (this GitHub repo, `main` branch) → Build (the matching CodeBuild project) → Deploy (ECS deploy action, pointed at the matching cluster/service, consuming `imagedefinitions.json`).

## 10. Migrate the data and create logins

Run from anywhere with network access to both Supabase and RDS — since RDS has no public access, that means from inside the VPC (an ECS `exec` session into the running backend task, a bastion, or temporarily via a Cloud9/EC2 box in the same VPC — not directly from your laptop).

```bash
cd scripts/aws-migration
npm ci
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AWS_SECRET_NAME, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID

node migrate-db.mjs              # copies every table from Supabase into RDS, preserving IDs
node create-cognito-users.mjs    # creates a Cognito login for every real person, links cognito_sub

API_URL=https://techportal-api.gyftr.net FRONTEND_URL=https://techportal.gyftr.net node doctor.js
API_URL=https://techportal-api.gyftr.net SMOKE_TEST_EMAIL=<any real person> node smoke-test.mjs
```

See `infra/HANDOVER.md` for the full credential/login list and troubleshooting if any step fails.

## 11. Deploying future changes

Push to `main` → CodePipeline picks it up automatically → CodeBuild builds+pushes the Docker image(s) → ECS deploy action rolls the service to the new image. No SSH, no manual `pm2 restart`, no manual `s3 sync` (unless you went with Option A for the frontend, in which case that step stays manual or gets its own small pipeline stage).

To force a one-off redeploy without a code change (e.g. after rotating a secret): `aws ecs update-service --cluster gyftr-tech-portal --service <service-name> --force-new-deployment`.
