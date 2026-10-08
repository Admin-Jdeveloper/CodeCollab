# CodeCollab 🚀

A scalable, reliable, and secure real-time collaborative coding platform with server-authoritative document versioning, containerized multi-language code execution, and distributed worker fleet architecture.

---

## Architecture Overview

```text
Browser / Monaco Editor
       │
       ├──── Socket.IO ──── Redis Adapter ──── Socket.IO × N
       │
       └──── Run Code (HTTP REST API)
                 │
                 ▼
             API / Server (Port 3000)
                 │
          ┌──────┴──────┐
          ▼             ▼
     PostgreSQL        Redis
     (Port 5432)   Queue / PubSub
                        │
                        ▼
                     BullMQ
                        │
             ┌──────────┼──────────┐
             ▼          ▼          ▼
          Worker 1   Worker 2   Worker N (Stateless Fleet)
             │          │          │
             └──────────┼──────────┘
                        ▼
               Restricted Docker Sandbox
             (alpine:3.20, non-root, isolated)
                        │
                 C / C++ / Python /
                 JavaScript / TypeScript
                        │
                        ▼
                 Execution Result
                        │
             PostgreSQL + Redis Pub/Sub
                        │
                        ▼
                 Socket.IO Server
                        │
                        ▼
                 Client Browser (Terminal Output)
```

---

## Key Features

- **Real-Time Collaboration**: Multi-user live editing powered by Monaco Editor and Socket.IO with `@socket.io/redis-adapter` for cluster-wide broadcast.
- **Server-Authoritative Document Versioning**: Monotonically increasing document versions reject stale edits (`SYNC_REQUIRED`) and prevent race conditions.
- **Multi-File Workspace**: Hierarchical file tree with live file creation, deletion, renaming, and deterministic room channels (`project:<id>:file:<id>`).
- **Distributed Execution Queue**: Asynchronous `POST /api/execution/run` returning `202 Accepted` immediately, backed by BullMQ on Redis.
- **Stateless Worker Fleet**: Dynamic worker pools consuming from BullMQ with automatic load distribution, crash failover, and heartbeats.
- **Multi-Language Docker Sandbox**:
  - **C** (`gcc -O2 -Wall`)
  - **C++** (`g++ -O2 -Wall`)
  - **Python** (`python3 -u`)
  - **JavaScript** (`node`)
  - **TypeScript** (`tsx`)
- **Zero-Trust Security Model**:
  - Non-root execution (`sandbox:1001`)
  - Linux capabilities dropped (`--cap-drop ALL`)
  - Network disabled (`--network none`)
  - Hard memory cap (`--memory 256m --memory-swap 256m`)
  - CPU cap (`--cpus 1.0`)
  - Process limit (`--pids-limit 64`) to prevent fork bombs
  - Output stream truncation (64 KB)
  - Automatic ephemeral container lifecycle cleanup
- **Reliability & Rate Limiting**:
  - Multi-level rate limiters for executions, socket connections, room joins, and project creations.
  - Client disconnect resilience (jobs complete even if user closes the tab).
  - Target container cancellation on demand (`docker rm -f`).
  - Idempotent job finalization guards.

---

## Quickstart

### Prerequisites

- [Bun](https://bun.sh/) (v1.2+) or Node.js (v20+)
- [Docker](https://www.docker.com/) & Docker Compose
- PostgreSQL (16+) & Redis (7+)

### 1. Running with Docker Compose (Recommended)

Start the entire fleet with one command:

```bash
docker compose up --build -d
```

Scale worker daemons dynamically:

```bash
docker compose up -d --scale daemon=3
```

Access the application:
- **Web Interface:** [http://localhost:3003](http://localhost:3003)
- **REST API:** [http://localhost:3000](http://localhost:3000)
- **Socket.IO:** [http://localhost:3001](http://localhost:3001)

### 2. Running Locally for Development

```bash
# 1. Start database & Redis
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=codeduo postgres:17-alpine
docker run -d -p 6379:6379 redis:7-alpine

# 2. Build the runner sandbox image
docker build -t codecollab-runner:latest -f docker/Dockerfile.runner .

# 3. Setup database schema
cd backend
bunx prisma migrate deploy

# 4. Start services (in separate terminals or via root scripts)
bun run dev:backend   # API server on port 3000
bun run dev:socket    # Socket server on port 3001
bun run worker        # BullMQ worker daemon
bun run dev:frontend  # Next.js UI on port 3003
```

---

## Testing & Quality Assurance

CodeCollab includes an end-to-end automated test suite:

```bash
# Run all tests
bun run test

# Individual suites:
bun run test:execution     # Sandbox multi-language runner tests
bun run test:collaboration # Real-time sync, versioning, and presence tests
bun run test:multi-socket  # Multi-node Socket.IO cluster Redis adapter tests
bun run test:scaling       # Worker concurrency, cancellation, failover tests
bun run test:security      # Comprehensive security and sandbox isolation tests
bun run test:load          # High-throughput 100+ execution distributed load test

# Static analysis:
bun run typecheck          # TypeScript compiler verification (0 errors)
bun run lint               # Code linting
bun run build              # Next.js production build verification
```

---

## Documentation

- [Architecture Specification](file:///f:/anti/26-june-leetcode-v0-assignment-main/docs/ARCHITECTURE.md)
- [Current System Architecture](file:///f:/anti/26-june-leetcode-v0-assignment-main/docs/CURRENT_ARCHITECTURE.md)
- [Execution Security & Isolation Spec](file:///f:/anti/26-june-leetcode-v0-assignment-main/docs/EXECUTION_SECURITY.md)
- [Production Deployment Guide](file:///f:/anti/26-june-leetcode-v0-assignment-main/docs/DEPLOYMENT.md)
