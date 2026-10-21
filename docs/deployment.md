# Deployment (AWS)

Pushes to `main` deploy the API to AWS through the `deploy` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), after `lint-and-test`, `docker-validation` and `infra` pass. It authenticates with GitHub OIDC, so no AWS access keys are stored in GitHub. Until it is configured, the job skips the AWS steps and stays green.

## Architecture

```
client ──HTTPS──▶ CloudFront ──HTTP──▶ ALB ──▶ ECS Fargate (Dockerfile) ─┬─▶ RDS PostgreSQL 17
                                                                         └─▶ ElastiCache Redis 7 (TLS + AUTH)
```

- **HTTPS without a domain:** CloudFront's default certificate fronts the ALB, so passwords and tokens never travel over plain HTTP. Nothing is cached. The ALB only admits CloudFront's origin-facing IP ranges ([`infra/cdn.tf`](../infra/cdn.tf), [`infra/network.tf`](../infra/network.tf)). `TRUST_PROXY=2` (CloudFront, then the ALB), so the per-IP rate limits see the real client.
- **API** ([`infra/app.tf`](../infra/app.tf)): one Fargate task (0.25 vCPU, 512 MiB) running the same image as Compose, with the same hardening: tini as PID 1 (`initProcessEnabled`), a read-only root filesystem with a writable `/tmp`. It runs pending migrations, then starts — the Compose `migrate` service. The ALB health check uses `/health` (liveness), not `/ready`.
- **PostgreSQL** ([`infra/database.tf`](../infra/database.tf)): RDS PostgreSQL 17 `db.t4g.micro`, private, reachable only from the task; RDS generates the master password and keeps it in Secrets Manager. The app connects without TLS (as to the local container), so a parameter group sets `rds.force_ssl = 0`; the traffic never leaves the VPC.
- **Redis** ([`infra/redis.tf`](../infra/redis.tf)): ElastiCache Redis 7 `cache.t4g.micro`, private, with an AUTH token (the Compose `requirepass`) and **`maxmemory-policy noeviction`**, like Compose (see [security](security.md)). ElastiCache only allows an AUTH token with in-transit encryption, so the task sets `REDIS_TLS=true`.
- **Secrets:** `JWT_SECRET`, `METRICS_TOKEN` and the Redis AUTH token are generated; they and the RDS-managed database password reach the container as ECS secrets (SSM SecureString / Secrets Manager), never as plain environment variables.
- **OpenAPI docs** are served at `/docs`, as everywhere else.

**Cost:** roughly US$60/month while it runs (RDS, ElastiCache, the ALB, the Fargate task, three public IPv4 addresses); `db.t4g.micro` and `cache.t4g.micro` are free-tier eligible on new accounts. Use the Destroy workflow between tests.

## One-time setup

With admin credentials for the target AWS account and `gh` logged in:

```bash
scripts/bootstrap.sh
```

It applies [`bootstrap/`](../bootstrap) (remote-state bucket + the `jwt-session-github-deploy` IAM role, which only the `production` environment of this repo can assume), then creates the `production` GitHub environment with `AWS_DEPLOY_ROLE_ARN`, `TF_STATE_BUCKET` and `AWS_REGION`. Extra arguments go to `terraform apply`: `-var="aws_region=…"` (default `eu-west-2`), `-var="create_oidc_provider=true"` on an account without the GitHub OIDC provider.

## What a deploy does

1. Creates the ECR repository (a no-op after the first run), builds the `runtime` stage of the `Dockerfile` and pushes it tagged with the commit SHA.
2. `terraform plan` + `apply` of [`infra/`](../infra) with S3 remote state (no backend block is committed; the job writes `infra/ci_backend.tf`). If RDS reports a parameter group change pending a reboot, it reboots the instance and restarts the API. Then it waits for the ECS service to be stable.
3. Smoke tests against the live API: `/ready` must report PostgreSQL and Redis ok, then the same [Postman collection](../jwt-redis-session-api.postman_collection.json) CI runs against Compose (a fresh user each run: create, login, profile, RBAC, refresh rotation and replay, logout, logout-all, and the sad paths), with the generated `METRICS_TOKEN`. The API and docs URLs are printed in the job summary.

The first deploy takes ~15–20 minutes (RDS, ElastiCache and CloudFront).

## Tear down / recreate

**Actions → Destroy → Run workflow** on `main`, type `destroy`. It deletes every resource in `infra/`, PostgreSQL and Redis data included (no final snapshot); the `bootstrap/` resources are kept, so **Actions → CI/CD Pipeline → Run workflow** on `main` recreates it. A recreated stack has new data stores and new generated secrets.

The deploy role's permissions ([`bootstrap/deploy_permissions.tf`](../bootstrap/deploy_permissions.tf)) are scoped by the `jwt-session` name prefix wherever AWS allows it, and to the deployment region for EC2, ELB, ECS, RDS and ElastiCache; it can only attach the ECS task-execution managed policy to roles it creates and can't modify itself.
