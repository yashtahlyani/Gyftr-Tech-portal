# AWS setup — Gyftr Tech Portal

Follow these in order. Everything here targets one region (pick one close to your users, e.g. `ap-south-1` for Mumbai) — use the same region for every resource below.

**Architecture:** browser → CloudFront → S3 (static frontend) · browser → ALB (HTTPS) → EC2 (Express API) → RDS Postgres (private, no public access). Cognito issues the tokens the frontend attaches to every API call; the API verifies them and looks up the caller in `people`.

---

## 1. VPC / networking

Use your account's default VPC unless you already have a dedicated one. You need at minimum:
- 2 public subnets (for the ALB) in different AZs
- 2 private subnets (for RDS) in different AZs — RDS requires a subnet group spanning 2+ AZs even for a single-AZ instance
- EC2 can sit in a public subnet with a security group restricting inbound to the ALB, or in a private subnet with a NAT gateway — either is fine; the simpler public-subnet-with-locked-down-SG approach is enough for an internal tool this size.

## 2. RDS (Postgres)

1. RDS console → **Create database** → Standard create → **PostgreSQL** (16.x).
2. Templates: **Dev/Test** (or Production if you want Multi-AZ — not required for this traffic level).
3. DB instance identifier: `gyftr-tech-portal`. Master username: `gyftr_admin`. Let RDS auto-generate the password, or set one — either way you'll put it in Secrets Manager next.
4. Instance class: `db.t4g.micro` is plenty for this app's traffic.
5. Storage: 20 GB gp3, no need for autoscaling at this size.
6. Connectivity: pick the VPC from step 1, create a **new security group** named `gyftr-rds-sg` — **no inbound rules yet** (you'll add one scoped to the EC2 security group after step 4 exists).
7. **Public access: No.** This is the whole point of dropping RLS in favor of a private DB — nothing but the API server can reach it.
8. Additional configuration → initial database name: `gyftr_tech_portal`.
9. Create. Note the endpoint hostname once it's available (Databases → gyftr-tech-portal → Connectivity & security).

## 3. Secrets Manager

1. Secrets Manager console → **Store a new secret** → "Credentials for Amazon RDS database".
2. Username/password: the master credentials from step 2. Select the `gyftr-tech-portal` RDS instance.
3. Secret name: `gyftr-tech-portal/rds` (matches `AWS_SECRET_NAME` in `backend/.env.example`).
4. Finish — no rotation needed for this setup.

## 4. Cognito

1. Cognito console → **Create user pool**.
2. Sign-in options: **Email**. Skip phone.
3. Password policy: default is fine (users get one shared strong-enough password anyway, set via admin API — nobody types a password that has to meet a policy at signup, since there's no self-signup).
4. MFA: off (internal tool, admin-created accounts).
5. **Self-registration: disable it.** All accounts are created by `scripts/aws-migration/create-cognito-users.mjs`, nobody signs themselves up.
6. Required attributes: email only.
7. Email delivery: default Cognito email is fine (we suppress the invite email anyway — `MessageAction: SUPPRESS` in the creation script).
8. User pool name: `gyftr-tech-portal`.
9. App client: name it `gyftr-tech-portal-web`, **public client (no secret)** — the SPA can't keep a secret.
10. **Important:** under the app client's Authentication flows, enable **`ALLOW_ADMIN_USER_PASSWORD_AUTH`** (needed by `create-cognito-users.mjs`'s verification and `smoke-test.mjs`) alongside the default `ALLOW_USER_SRP_AUTH` (used by the actual frontend login).
11. Create. Note the **User pool ID** and **App client ID** — you'll need both in `backend/.env`, `.env` (frontend), and `scripts/aws-migration/.env`.

## 5. EC2 (the API server)

1. EC2 console → **Launch instance**. Name: `gyftr-tech-portal-api`.
2. AMI: Amazon Linux 2023. Instance type: `t4g.micro` (or `t3.micro` if not using Graviton).
3. Key pair: create/select one you can SSH in with.
4. Network: same VPC as RDS. Security group `gyftr-api-sg`: inbound **from the ALB's security group only** on port 4000 (you'll create the ALB's SG in step 6 — come back and lock this down once it exists; until then, temporarily allow your own IP on port 4000 for testing).
5. Launch. Once running, SSH in and go back to RDS's security group (`gyftr-rds-sg`) and add an inbound rule: PostgreSQL (5432) from `gyftr-api-sg`.

SSH in and run:

```bash
sudo dnf install -y git
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
sudo npm install -g pm2

git clone <your-repo-url> app
cd app/backend
npm ci --omit=dev

cp .env.example .env
nano .env   # fill in AWS_SECRET_NAME, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_REGION, FRONTEND_URL

pm2 start server.js --name gyftr-api
pm2 save
pm2 startup   # follow the printed instructions so it survives a reboot
```

The EC2 instance's IAM role needs permission to read the Secrets Manager secret from step 3 — attach a policy allowing `secretsmanager:GetSecretValue` scoped to `arn:aws:secretsmanager:<region>:<account>:secret:gyftr-tech-portal/rds-*`.

Verify: `curl http://localhost:4000/health` should return `{"ok":true}`.

## 6. ALB (HTTPS in front of EC2)

1. Request a certificate first: ACM console → **Request a public certificate** for your API's domain (e.g. `api.portal.yourcompany.com`) → DNS validation → add the CNAME record ACM gives you to your DNS provider → wait for "Issued".
2. EC2 console → **Load Balancers** → **Create** → Application Load Balancer. Name: `gyftr-api-alb`. Internet-facing. Same VPC, the two public subnets from step 1.
3. Security group: allow inbound 443 from `0.0.0.0/0`.
4. Listener: HTTPS:443, attach the ACM certificate from step above.
5. Target group: `gyftr-api-tg`, target type Instance, protocol HTTP, port 4000, health check path `/health`. Register the EC2 instance from step 5.
6. Once the ALB is created, go back to `gyftr-api-sg` (the EC2 security group) and restrict inbound port 4000 to just the ALB's security group (remove any temporary "my IP" rule from step 5).
7. Point your API domain's DNS (A/ALIAS record) at the ALB's DNS name.

## 7. S3 + CloudFront (the frontend)

1. S3 console → **Create bucket**, name `gyftr-tech-portal-web` (bucket names are global — pick something unique). Block all public access — CloudFront will access it via an Origin Access Control, not a public bucket policy.
2. CloudFront console → **Create distribution**. Origin: the S3 bucket, origin access control → create one and let CloudFront update the bucket policy for you when prompted.
3. Default root object: `index.html`.
4. Error pages: this app has no client-side router (no react-router), so you don't need a 404→index.html rewrite the way most SPAs do — skip this.
5. Request an ACM certificate for your frontend domain (e.g. `portal.yourcompany.com`) **in `us-east-1`** — CloudFront only accepts certs from that region regardless of where everything else lives. Attach it under "Custom SSL certificate" and add the domain under "Alternate domain names (CNAMEs)".
6. Point your frontend domain's DNS at the CloudFront distribution (ALIAS/CNAME per your DNS provider's instructions).

## 8. Build and deploy the frontend

On your own machine (or wherever you build from):

```bash
cp .env.example .env
# fill in:
#   VITE_API_URL=https://api.portal.yourcompany.com
#   VITE_COGNITO_USER_POOL_ID=<from step 4>
#   VITE_COGNITO_CLIENT_ID=<from step 4>
npm ci
npm run build
aws s3 sync dist/ s3://gyftr-tech-portal-web --delete
aws cloudfront create-invalidation --distribution-id <your-distribution-id> --paths "/*"
```

## 9. Migrate the data and create logins

From your own machine (needs network access to both Supabase and RDS — RDS being private means this has to run from inside the VPC, e.g. via an SSH tunnel through the EC2 box, or temporarily run it on the EC2 instance itself):

```bash
cd scripts/aws-migration
npm ci
cp .env.example .env
nano .env   # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AWS_SECRET_NAME, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID

# 1. Load the schema (once)
psql "$(node -e "...")" -f ../../backend/db/schema.sql   # or just paste schema.sql into any Postgres client connected to RDS

# 2. Copy every row over from Supabase, preserving IDs
node migrate-db.mjs

# 3. Create a Cognito login for every real person, link cognito_sub
node create-cognito-users.mjs

# 4. Confirm everything actually works end-to-end
API_URL=https://api.portal.yourcompany.com SMOKE_TEST_EMAIL=<any real person's email> node smoke-test.mjs
```

See `infra/HANDOVER.md` for the full credential/login list and what to do if something in this list fails.

## 10. Deploying future changes

**Frontend:** `npm run build` → `aws s3 sync dist/ s3://gyftr-tech-portal-web --delete` → `aws cloudfront create-invalidation --distribution-id <id> --paths "/*"`.

**Backend:** SSH into the EC2 instance:
```bash
cd app && git pull
cd backend && npm ci --omit=dev
pm2 restart gyftr-api
```

If you want this automated later, a GitHub Actions workflow can run the frontend steps on every push to `main`, and either SSH into EC2 to redeploy the backend or (better, once you're comfortable) move the backend onto something that redeploys itself from a container registry — not necessary for launch.
