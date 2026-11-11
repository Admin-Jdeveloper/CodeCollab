# CodeCollab 🚀

A real-time collaborative coding platform engineered for low latency and zero state drift. Features Monaco-grade editing, server-authoritative document synchronization (Socket.IO + Yjs CRDTs), immutable Git-like workspace snapshots with atomic transactional rollbacks, and sandboxed Docker code execution.

---

## 🏗️ System Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Next.js 15 Client (Browser)                     │
│    Monaco Editor • Yjs CRDT Binding • Multi-File Tree • VCS Panel      │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │ HTTPS REST                     │ WSS (Socket.IO)
                    ▼                                ▼
       ┌────────────────────────┐       ┌────────────────────────┐
       │   Render Web Service   │       │   Render Web Service   │
       │   "codecollab-api"     │       │  "codecollab-socket"   │
       │   Port 3000            │       │   Port 3001            │
       └───────────┬────────────┘       └───────────┬────────────┘
                   │                                │
                   ├───────────────┬────────────────┤
                   ▼                                ▼
       ┌────────────────────────┐       ┌────────────────────────┐
       │   PostgreSQL 17        │       │   Redis 7              │
       │   Users, Accounts,     │       │   Pub/Sub Adapter,     │
       │   Rooms, Files,        │       │   BullMQ Queue,        │
       │   Commit Snapshots     │       │   Rate Limiters        │
       └────────────────────────┘       └───────────┬────────────┘
                                                    │
                                                    ▼
                                        ┌────────────────────────┐
                                        │ Execution Worker Fleet │
                                        │ BullMQ + Docker Pool   │
                                        └────────────────────────┘
```

---

## ⚡ Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, Monaco Editor (`@monaco-editor/react`), Yjs, Tailwind CSS v4, Lucide Icons, NextAuth v5 (Auth.js) with Google OAuth.
- **Backend API**: Express 5 on Bun runtime, Prisma ORM 7 (`@prisma/adapter-pg`), PostgreSQL, BullMQ, Redis.
- **Real-Time Sync**: Socket.IO 4.8 with Redis Adapter for horizontal multi-instance scaling, Yjs binary CRDT protocol with monotonic server sequence locks.
- **Code Execution**: Ephemeral Docker sandboxes with CPU/memory quotas, execution timeouts, and network isolation (`--network none`).

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- [Bun](https://bun.sh) (v1.1+)
- [Docker Desktop](https://www.docker.com) (for local PostgreSQL & Redis)

### 2. Start Infrastructure
```bash
docker compose up -d
```
This starts:
- PostgreSQL on `localhost:5432` (`codeduo`)
- Redis on `localhost:6379`

### 3. Install Dependencies & Generate Database Client
```bash
bun install
cd backend && bun install && bun run db:generate
cd ../frontend && bun install
```

### 4. Environment Variables
Copy and sanitize the environment templates:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

### 5. Run Services
In three separate terminal tabs (or using monorepo scripts):
```bash
# Terminal 1: REST API Server (Port 3000)
cd backend && bun run dev

# Terminal 2: Socket.IO Real-Time Sync (Port 3001)
cd backend && bun run dev:socket

# Terminal 3: Next.js Frontend (Port 3003)
cd frontend && bun run dev
```

Visit `http://localhost:3003` to start coding.

---

## 🩺 Health-Check Endpoints (Render / Uptime Monitoring)

Both backend services expose unauthenticated, zero-overhead GET `/health` routes for external monitors (e.g. UptimeRobot, Render keep-alive):

- **REST API**:
  `GET https://<YOUR-API-SERVICE>.onrender.com/health`
  ```json
  {
    "status": "ok",
    "service": "api",
    "message": "API service is alive"
  }
  ```

- **Socket.IO Sync**:
  `GET https://<YOUR-SYNC-SERVICE>.onrender.com/health`
  ```json
  {
    "status": "ok",
    "service": "sync",
    "message": "Socket.IO service is alive"
  }
  ```

---

## 🧪 Testing & Validation

```bash
# Full test suite
bun run test

# Typecheck both backend and frontend
bun run typecheck

# Lint frontend
bun run lint
```
