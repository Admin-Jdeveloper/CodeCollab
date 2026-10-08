# CodeCollab — Production Deployment & Operations Guide

## 1. Overview & Architecture

CodeCollab is architected as a cloud-native, distributed collaborative coding platform. The system separates the real-time collaboration layer, stateful database, job queue, and secure containerized code execution into isolated, horizontally scalable tiers.

### Production Target Topology

```text
                                  Internet
                                     │
                             ┌───────▼───────┐
                             │ Load Balancer │
                             │  (TLS / SSL)  │
                             └───────┬───────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
       ┌──────────────────┐                    ┌──────────────────┐
       │   Web UI & API   │                    │  Socket.IO Node  │
       │  (Next.js / Bun) │                    │      (1..N)      │
       └─────────┬────────┘                    └────────┬─────────┘
                 │                                      │
                 │              PRIVATE NETWORK         │ (Pub/Sub Adapter)
                 ├──────────────────────────────────────┼─────────────────┐
                 │                                      │                 │
                 ▼                                      ▼                 │
       ┌──────────────────┐                   ┌──────────────────┐        │
       │    PostgreSQL    │                   │   Redis Cluster  │        │
       │    (Port 5432)   │                   │   (Port 6379)    │        │
       │  [State Storage] │                   │ [Queue & PubSub] │        │
       └─────────▲────────┘                   └─────────┬────────┘        │
                 │                                      │                 │
                 │                                      ▼                 │
                 │                               ┌──────────────┐         │
                 │                               │    BullMQ    │         │
                 │                               │  Task Queue  │         │
                 │                               └──────┬───────┘         │
                 │                                      │                 │
                 │         ┌────────────────────────────┼─────────────┐   │
                 │         ▼                            ▼             ▼   │
                 │  ┌──────────────┐             ┌──────────────┐     │   │
                 └──┤ Worker 1     │             │ Worker 2..N  │     │   │
                    │ (BullMQ)     │             │ (BullMQ)     │     │   │
                    └──────┬───────┘             └──────┬───────┘     │   │
                           │                            │             │   │
                           ▼                            ▼             │   │
                    ┌──────────────┐             ┌──────────────┐     │   │
                    │ Docker Host  │             │ Docker Host  │     │   │
                    │ Sandbox Pool │             │ Sandbox Pool │     │   │
                    └──────────────┘             └──────────────┘     │   │
                                                                      │   │
                    [Execution Events Published Back to Socket.IO] ───┴───┘
```

> [!IMPORTANT]
> **Private Network Isolation:**
> PostgreSQL, Redis, Worker Daemons, and the Docker daemon must **NEVER** be bound to public interfaces or exposed to the internet. They must reside in an isolated VPC or Docker internal network accessible only by authorized application containers.

---

## 2. Docker Compose Deployment

The repository includes a complete, multi-container `docker-compose.yml` specification.

### 2.1 Starting the Complete Fleet

```bash
# Build images and start all services in detached mode
docker compose up --build -d
```

### 2.2 Scaling Worker Capacity Dynamically

Worker daemons are stateless consumers. To scale the execution fleet to 3 (or more) concurrent worker nodes:

```bash
docker compose up -d --scale daemon=3
```

BullMQ automatically balances queued jobs across all registered workers with automatic heartbeats and crash failover.

### 2.3 Stopping and Cleaning Up

```bash
# Graceful stop
docker compose down

# Stop and wipe persistent volume data (fresh install)
docker compose down -v
```

---

## 3. Environment Variables Reference

| Variable | Service | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | server, socket, daemon | `postgresql://postgres:postgres@localhost:5432/codeduo` | PostgreSQL connection URI |
| `REDIS_HOST` | server, socket, daemon | `127.0.0.1` | Redis host |
| `REDIS_PORT` | server, socket, daemon | `6379` | Redis port |
| `REDIS_PASSWORD` | server, socket, daemon | *empty* | Redis authentication password (if enabled) |
| `PORT` | server | `3000` | HTTP REST API listening port |
| `SOCKET_PORT` | socket | `3001` | Socket.IO server listening port |
| `WORKER_ID` | daemon | `worker-<pid>-<rand>` | Unique identifier for the worker daemon |
| `WORKER_CONCURRENCY`| daemon | `3` | Number of simultaneous execution jobs per worker |
| `MAX_COMPILE_TIME_MS`| daemon | `15000` | Maximum compilation timeout in milliseconds |
| `MAX_EXECUTION_TIME_MS`| daemon| `12000` | Maximum execution timeout in milliseconds |
| `NEXT_PUBLIC_BACKEND_URL`| web | `http://localhost:3000` | Public URL for frontend REST API requests |
| `NEXT_PUBLIC_SOCKET_URL` | web | `http://localhost:3001` | Public URL for Socket.IO WebSocket traffic |
| `AUTH_SECRET` | web | *required* | NextAuth session encryption secret (32+ chars) |

---

## 4. Database Migrations & Prisma Setup

Before starting application servers, ensure the PostgreSQL database schema is migrated:

```bash
cd backend

# Generate Prisma Client models
bunx prisma generate

# Apply pending schema migrations
bunx prisma migrate deploy
```

In development environments, you can push schema changes directly:

```bash
bunx prisma db push
```

---

## 5. Building the Docker Runner Sandbox

Worker daemons require the pinned runner image `codecollab-runner:latest` to execute user code in isolated containers:

```bash
# Build sandbox image from project root
docker build -t codecollab-runner:latest -f docker/Dockerfile.runner .
```

The runner image is based on Alpine Linux 3.20 and includes:
- GCC & G++ compilers (C & C++)
- Python 3.12 (`python3`)
- Node.js & TypeScript (`tsx`)
- Unprivileged user `sandbox:sandbox` (UID 1001, GID 1001)

---

## 6. Health & Readiness Probes

CodeCollab exposes Kubernetes-compatible health checks on all server nodes:

- **Liveness Probe:** `GET /health` (Returns HTTP 200 `{ status: "ok" }`)
- **Readiness Probe:** `GET /ready` (Verifies live connectivity to both PostgreSQL and Redis; returns HTTP 200 `{ status: "ready" }` or HTTP 503)

---

## 7. Operational Runbook & Verification

### 7.1 Running the Automated Test Suites

```bash
# Run all unit, integration, scaling, security, and load tests
bun run test

# Run individual verification suites:
bun run test:execution     # Multi-language runner sandbox tests (C, C++, Py, JS, TS)
bun run test:collaboration # Real-time editing, presence, and versioning tests
bun run test:multi-socket  # Multi-node Socket.IO cluster Redis adapter tests
bun run test:scaling       # Worker concurrency, cancellation, failover, and rate limiting
bun run test:security      # Security audit (network isolation, caps, non-root, mem limits)
bun run test:load          # High-throughput 100+ execution distributed load test
```

### 7.2 Worker Crash Recovery

If a worker crashes or is killed (`SIGKILL`), BullMQ detects the stalled job lock (lockDuration 30s) and automatically re-assigns the job to another healthy active worker. Active containers are labelled `codecollab-exec-<id>` and can be pruned using:

```bash
docker rm -f $(docker ps -a --filter "name=codecollab-exec-" -q)
```

---

## 8. Known Limitations & Production Best Practices

1. **Docker-in-Docker in Containerized Workers**: In production Kubernetes or AWS ECS environments where mounting the host `/var/run/docker.sock` is restricted by security policies, deploy workers using Firecracker microVMs, AWS Fargate tasks, or gVisor (`runsc`) runtimes.
2. **WebSocket Load Balancer Affinity**: When deploying multiple Socket.IO nodes behind an NGINX or AWS ALB load balancer, enable cookie-based session stickiness or configure WebSocket upgrade headers (`Upgrade $http_upgrade`, `Connection "upgrade"`).
3. **Redis High Availability**: For production workloads, deploy Redis in Sentinel or Cluster mode with persistent AOF (Append-Only File) logging enabled.
