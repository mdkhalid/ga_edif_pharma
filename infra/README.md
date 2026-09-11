# Infrastructure

Infrastructure as code, container definitions and operational scripts.

```
infra/
├── docker/          Local development stack + production Dockerfiles
├── terraform/       Cloud resources, per environment
├── k8s/             Kubernetes manifests (if using K8s over ECS)
├── nginx/           Reverse-proxy configuration
├── observability/   Prometheus, Grafana, Loki, OpenTelemetry
└── scripts/         Operational scripts
```

---

## Local development

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

| Service | Port | Purpose |
|---|---|---|
| PostgreSQL 17 | 5432 | Primary database, extensions pre-installed |
| Redis 7 | 6379 | Cache, rate limiting, sessions, queues |
| OpenSearch 2.17 | 9200 | Search (optional — Postgres FTS is the default) |
| OpenSearch Dashboards | 5601 | Index inspection |
| MinIO | 9000 / 9001 | S3-compatible object storage |
| MailHog | 1025 / 8025 | Email capture with a web UI |
| Kafka | 9092 | Event streaming (optional, `--profile events`) |

Postgres extensions installed on first boot (`postgres-init/01-extensions.sql`):
`uuid-ossp`, `pgcrypto`, `pg_trgm`, `unaccent`, `btree_gin`, `citext`. PostGIS is
commented out until geo delivery zones are needed.

---

## Terraform

```
terraform/
├── modules/
│   ├── networking/      VPC, subnets, security groups, NAT
│   ├── database/        RDS PostgreSQL, parameter groups, backups, replicas
│   ├── cache/           ElastiCache Redis
│   ├── search/          OpenSearch domain
│   ├── storage/         S3 buckets, lifecycle policies, encryption
│   ├── compute/         ECS Fargate (or EC2), ALB, autoscaling
│   ├── cdn/             CloudFront + WAF
│   ├── secrets/         Secrets Manager
│   └── observability/   Log groups, alarms, dashboards
└── environments/
    ├── dev/
    ├── staging/
    └── prod/
```

```bash
cd infra/terraform/environments/dev
terraform init
terraform plan
terraform apply
```

Remote state in S3 with DynamoDB locking. Never commit `.tfstate`.

---

## Environment sizing

| Resource | dev | staging | prod |
|---|---|---|---|
| API pods | 1 | 2 | 3–40 (autoscaled) |
| DB | Small | Production-shaped | Multi-AZ, production-sized |
| Read replicas | 0 | 1 | 1–3 |
| Redis | Single | Single | Cluster |
| OpenSearch | Off | 1 node | 3 nodes |
| PITR | No | 7 days | 35 days |

**Staging must be production-shaped.** Different instance sizes or a different
Postgres version means staging does not predict production behaviour — it predicts
staging behaviour.

---

## Database connection sizing — check this before scaling pods

```
max_connections (Postgres)          200
  − superuser reserved                3
  − replication slots                 2
  − admin / monitoring                5
  = available for the application   190

At pool_max = 20 per pod  →  190 / 20 = 9 pods maximum
```

**At 12 pods with `pool_max = 20`, you have 240 connections against a limit of 200.**
Postgres refuses connections, pods crash-loop, and the incident looks like a database
failure when it is a configuration failure.

Mitigations, in order:

1. Right-size the pool: `pool_max = ceil(peak_concurrent_queries_per_pod × 1.2)`. For
   an I/O-bound API, 10–15 is usually sufficient.
2. Add **PgBouncer in transaction mode** — 12 pods × 15 collapse to ~40 server
   connections. This should be in place by phase 2.
3. `statement_timeout = 10s` — a runaway query otherwise holds a connection forever.
4. `idle_in_transaction_session_timeout = 30s` — a leaked transaction holds locks,
   which is worse than a leaked connection.

---

## Kubernetes

```
k8s/
├── base/            deployments, services, configmaps, secrets refs
├── overlays/        dev / staging / prod patches
├── hpa/             autoscaling policies
└── ingress/         routing, TLS, rate limiting
```

Autoscaling uses **CPU and RPS together**:

- CPU alone misses a pod blocked on an external API at 20% CPU with a growing queue.
- RPS alone misses a pod doing heavy JSON serialisation that saturates CPU first.

```yaml
behavior:
  scaleUp:
    stabilizationWindowSeconds: 30      # react fast to a spike
    policies:
      - { type: Percent, value: 100, periodSeconds: 60 }
      - { type: Pods,   value: 6,   periodSeconds: 60 }
    selectPolicy: Max
  scaleDown:
    stabilizationWindowSeconds: 300     # shrink slowly, avoid flapping
```

`minReplicas: 3` — fewer means a single pod restart during a deploy visibly degrades
capacity, and a node failure removes a third of the fleet.

---

## Reverse proxy

| Setting | Value | Reason |
|---|---|---|
| Balancing | Least outstanding requests | Request cost varies (a report vs a product read) |
| Health check | `/health/ready` | Must return **503** when a dependency is down |
| Deregistration delay | 30 s | Matches the graceful-shutdown drain window |
| Idle timeout | 60 s | Above the app's 30 s request timeout |
| Sticky sessions | **Disabled** | The tier is stateless; affinity defeats autoscaling |
| TLS | Terminated at the LB, 1.2+ | Re-encrypted to the backend |

---

## Observability

| Concern | Tool |
|---|---|
| Metrics | Prometheus + Grafana (RED per endpoint, USE per resource) |
| Logs | Pino JSON → Loki / CloudWatch (30 days hot, 1 year cold) |
| Traces | OpenTelemetry → Tempo / Jaeger |
| Errors | Sentry with release + correlation id |
| Alerts | Alertmanager, tiered P1/P2/P3, each with a runbook |

**The most valuable alert is a business-metric alert.** "Zero orders in 15 minutes
during business hours" catches a broken checkout that returns HTTP 200 for every
request — invisible to infrastructure dashboards.

---

## Operational scripts

| Script | Purpose |
|---|---|
| `backup.sh` | Trigger an on-demand backup |
| `restore-drill.sh` | Restore to a scratch instance and verify — run quarterly |
| `reindex-search.sh` | Rebuild the search index from PostgreSQL |
| `rebuild-salt-keys.sh` | Recompute every `composition_key` from its composition rows |
| `verify-stock-integrity.sh` | Assert `Σ(stock_ledger) = qty_on_hand` for every batch |
| `seed-demo-data.sh` | Populate a demo environment |

**`restore-drill.sh` is the one that matters.** A backup that has never been restored
is not a backup. The drill is a quarterly calendar commitment with a named owner, and
the restore is timed against the RTO.

---

## Pre-scale checklist

Before increasing pod count in production, verify:

- [ ] `pool_max × pod_count` stays under the database connection limit
- [ ] PgBouncer is in place if the count approaches the limit
- [ ] `statement_timeout` and `idle_in_transaction_session_timeout` are set
- [ ] Read replicas are configured for read-heavy endpoints
- [ ] Redis can handle the projected ops/s
- [ ] Health checks return 503 correctly when a dependency is down
- [ ] Graceful shutdown drains within the deregistration delay
- [ ] A load test at 3× the new expected peak has passed
