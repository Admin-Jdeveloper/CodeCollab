# CodeCollab — Developer Startup Guide

## Architecture Overview

```text
Frontend (Next.js, Port 3003) ←─────────────────────────────→ Browser (Monaco Editor)
               │                                                      │
               │ REST API calls (Async)           Socket.IO (WS/poll) │
               ▼                                                      │
Backend REST (Bun/Express, Port 3000)                                 │
               │                                                      │
               ├──── Prisma ────→ PostgreSQL                          │
               │                                                      │
               └──── Redis ─────→ BullMQ Queue ────────┐              │
                                                       │              │
Socket Server (Bun/Socket.IO, Port 3001) ←─────────────┼──────────────╯
               │                                       │
               ├──── Prisma ────→ PostgreSQL           │
               └──── Redis Adapter                     │
                                                       ▼
                                      Stateless Workers (1..N)
                                                       │
                                      Docker Sandbox (alpine:3.20)
```

---

## Quick Start

### 1. Database & Cache
Ensure PostgreSQL and Redis are running:
```bash
docker compose up -d postgres redis
```

### 2. Generate Prisma Client & Migrate Schema
```bash
cd backend
bunx prisma generate
bunx prisma db push
```

### 3. Build Runner Sandbox Image
```bash
docker build -t codecollab-runner:latest -f docker/Dockerfile.runner .
```

### 4. Start Development Services

**Option A: Using Docker Compose**
```bash
docker compose up --build
```

**Option B: Running with Bun locally**
In separate terminals:
```bash
# Terminal 1: Backend REST API (Port 3000)
bun run dev:backend

# Terminal 2: Socket.IO Server (Port 3001)
bun run dev:socket

# Terminal 3: BullMQ Execution Worker
bun run worker

# Terminal 4: Frontend Web App (Port 3003)
bun run dev:frontend
```

Then open **http://localhost:3003** in your browser.

---

## Verification & Automated Testing

Run the full automated test suite:
```bash
bun run test
```

Or run individual suites:
- `bun run test:execution` — Multi-language runner sandbox tests
- `bun run test:collaboration` — Real-time editing, presence, and versioning tests
- `bun run test:multi-socket` — Socket.IO cluster Redis adapter tests
- `bun run test:scaling` — Worker concurrency, cancellation, failover tests
- `bun run test:security` — Security and sandbox isolation tests
- `bun run test:load` — High-throughput 100+ execution distributed load test

---

## Service Port Map

| Service | Port | Description |
|---|---|---|
| Next.js Frontend | 3003 | Web workspace & Monaco Editor UI |
| Express REST API | 3000 | Auth, rooms, commits, async execution dispatch |
| Socket.IO Server | 3001 | Real-time code sync, presence, terminal events |
| Redis | 6379 | Socket.IO adapter pub/sub, BullMQ queue, rate limiting |
| PostgreSQL | 5432 | Persistent state (Users, Rooms, Files, Commits, Executions) |
