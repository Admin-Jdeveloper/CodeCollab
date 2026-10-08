# CodeCollab — Target Scalable & Secure Architecture

## 1. System Architecture Flow

The end-to-end architecture pipeline connects the browser client to isolated sandbox execution:

```text
Browser / Monaco Editor (Client)
       │
       ▼
Frontend (Next.js 15, React 19, Monaco Editor, Tailwind CSS)
       │
       ▼
Socket.IO / REST API Server Cluster
       │
       ▼
Redis & PostgreSQL
  ├── Redis: Adapter Pub/Sub, BullMQ Queue ("code-execution"), Rate Limiting
  └── PostgreSQL: Permanent State (Users, Rooms, Files, Commits, Executions)
       │
       ▼
BullMQ Worker Fleet / Execution Daemon
       │
       ▼
Compiler / Runtime Sandbox (Docker Containers: C, C++, Python, JS, TS)
```

```text
Browser / Monaco Editor
       │
       ├── Socket.IO (WSS / Long Polling)
       │      │
       │      ▼
       │  Socket.IO Node Cluster (Ports 3001..N)
       │      │
       │      ├── @socket.io/redis-adapter ──→ Redis Pub/Sub (Channel: socket.io)
       │      │
       │      └── Authoritative Document Manager
       │             ├── In-Memory LRU Cache
       │             └── PostgreSQL (Permanent Storage)
       │
       └── Execution Trigger (HTTP POST /api/execution/run)
              │
              ▼
          REST API Server (Express / Bun)
              │
       ┌──────┴──────────────────────────┐
       ▼                                 ▼
  PostgreSQL (Persistent State)       Redis (Rate Limiting + BullMQ)
  - Execution (status: QUEUED)           - Queue: "code-execution"
  - File / Room State                    - PubSub: "execution-events"
                                         │
                                         ▼
                                  BullMQ Queue
                                         │
                     ┌───────────────────┼───────────────────┐
                     ▼                   ▼                   ▼
               Worker 1            Worker 2            Worker N
               (daemon-1)          (daemon-2)          (daemon-N)
                     │                   │                   │
                     └───────────────────┼───────────────────┘
                                         ▼
                               ExecutionService
                                         │
                                         ▼
                                   Docker Sandbox
                          (Ephemeral Restricted Container)
                          - Non-root user (sandbox:1000)
                          - Network: none (--network none)
                          - CPU limit: 1.0 core (--cpus 1.0)
                          - Memory limit: 256MB (-m 256m)
                          - PIDs limit: 64 (--pids-limit 64)
                          - Read-only root filesystem
                          - Tmpfs workspace mount
                          - Execution / Compilation Timeouts
                                         │
                                         ▼
                             Execution Output Collector
                                         │
                        ┌────────────────┴────────────────┐
                        ▼                                 ▼
              PostgreSQL Update                 Redis Pub/Sub
              (Status: COMPLETED / ERROR)       (Channel: "execution-events")
                                                          │
                                                          ▼
                                                  Socket.IO Servers
                                                          │
                                                          ▼
                                                 Browser Workspace
                                                (Live Terminal Output)
```

---

## 2. Core Responsibilities & Technology Stack

| Layer | Technology | Primary Responsibilities |
|---|---|---|
| **Client** | Next.js 15, React 19, Monaco Editor | Rich UI, real-time code editing, connection state indicators (🟢/🟡/🔴), terminal & VCS panels |
| **Realtime Sync** | Socket.IO 4.8+, `@socket.io/redis-adapter` | Multi-node room routing, server-authoritative document versioning, transient cursor presence, chat |
| **API Server** | Express 5, Bun/Node, NextAuth | Authentication, authorization, project/file management, execution dispatching, rate limiting |
| **Persistence** | PostgreSQL 17, Prisma ORM | Persistent storage for users, rooms, files, commits, messages, and execution records |
| **Queue & Cache** | Redis 7, BullMQ | Asynchronous job queuing, distributed locks, rate limiting, pub/sub event bus |
| **Worker Fleet** | Node/Bun Stateless Workers | Consumes BullMQ jobs, manages container lifecycles, collects stdout/stderr, persists results |
| **Sandbox Isolation** | Docker Engine | Secure containerized compilation and execution for C, C++, Python, JavaScript, TypeScript |

---

## 3. Detailed Component Specifications

### 3.1 Real-Time Collaborative Editing & Document Versioning
- **Server Authoritative Versioning**:
  - Every file maintains a monotonically increasing integer `version` field (starting at 1) both in DB and memory.
  - Client payloads contain:
    ```json
    {
      "roomId": "...",
      "fileId": "...",
      "filePath": "/main.cpp",
      "version": 42,
      "content": "..."
    }
    ```
  - **Synchronization Rules**:
    - If `clientVersion === serverVersion`: Accept update, increment `serverVersion = serverVersion + 1`, broadcast `code_update` with new version to room peers, debounced persist to DB.
    - If `clientVersion < serverVersion`: Reject update, emit `sync_required` to sender containing current `serverVersion` and authoritative `content`. Monaco editor aligns without data corruption.
- **File Room Scoping**:
  - Sockets join room channels: `room:<roomId>` and `room:<roomId>:file:<fileId>`.
- **Transient Presence & Cursors**:
  - Events: `user_joined`, `user_left`, `cursor_update`.
  - Cursor coordinates (`line`, `column`, `selection`) are transiently broadcast to peers and never written to PostgreSQL.

### 3.2 Reconnection & Synchronization State Machine
- Socket.IO client reconnection strategy:
  ```ts
  {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  }
  ```
- **Connection Indicators**:
  - 🟢 Connected
  - 🟡 Reconnecting...
  - 🔴 Connection lost
- **Reconnection Sequence**:
  1. Socket connects / reconnects.
  2. Sockets re-authenticates and rejoins room channels with `lastKnownVersion`.
  3. Server validates authorization and responds with current authoritative `version` and `content`.
  4. Client updates Monaco model if version divergence occurred while offline.
  5. Active executions continue independently on workers and emit completion state to DB.

### 3.3 Asynchronous Execution Pipeline (BullMQ + Redis)
- **Non-blocking Dispatch**:
  - `POST /api/execution/run` validates parameters, creates an `Execution` record with status `QUEUED`, enqueues a job into BullMQ queue `code-execution`, and responds immediately (`202 Accepted`):
    ```json
    {
      "executionId": "cuid-xyz",
      "status": "QUEUED"
    }
    ```
- **Job Payload**:
  ```json
  {
    "executionId": "...",
    "userId": "...",
    "roomId": "...",
    "fileId": "...",
    "language": "cpp",
    "sourceCode": "...",
    "stdin": "..."
  }
  ```
- **Execution Lifecycle**:
  `QUEUED` → `RUNNING` → `COMPLETED` | `COMPILE_ERROR` | `RUNTIME_ERROR` | `TIMEOUT` | `CANCELLED` | `FAILED`.

### 3.4 Docker Sandbox Isolation & Security
- User code is executed inside ephemeral Docker containers created per run:
  - **No Host Privileges**: Container runs as unprivileged user (`uid: 1001`).
  - **Network Isolation**: `--network none` guarantees no egress/ingress traffic.
  - **Resource Bounds**:
    - `MAX_CPU`: 1.0 CPU (`--cpus 1.0`).
    - `MAX_MEMORY`: 256 MB (`--memory 256m`).
    - `MAX_PIDS`: 64 processes (`--pids-limit 64`).
    - `MAX_COMPILE_TIME`: 10 seconds.
    - `MAX_EXECUTION_TIME`: 8 seconds.
    - `MAX_OUTPUT_SIZE`: 64 KB (truncates infinite stream loops).
    - `MAX_SOURCE_SIZE`: 64 KB.
    - `MAX_STDIN_SIZE`: 32 KB.
  - **Filesystem Isolation**:
    - Root filesystem mounted read-only (`--read-only`).
    - Workspace mounted on temporary tmpfs (`--tmpfs /workspace:rw,noexec=false,size=64m`).
  - **Cleanup Guarantee**:
    - Guaranteed container removal (`--rm` and container kill in `finally` block).
    - Workspace temporary directory deleted immediately upon completion.

### 3.5 Execution Cancellation
- `POST /api/execution/:id/cancel`:
  - If job is in `QUEUED` state: Removed from BullMQ queue and marked `CANCELLED`.
  - If job is in `RUNNING` state: Worker receives cancellation signal via Redis PubSub, inspects running container name (`codecollab-exec-<executionId>`), forces Docker container kill (`docker kill`), cleans temporary mount, and updates execution status to `CANCELLED`.
  - Host processes are never killed via arbitrary port termination.

### 3.6 Rate Limiting & Authorization
- **Redis Token-Bucket Rate Limiter**:
  - Executions: 10 executions/min per user, max 2 concurrent executions per user.
  - Socket events: Handshake & room-join throttled.
  - Room & File creation: 20 creates/min per IP/user.
- **Server-Side Authorization**:
  - All room access, file edits, and execution requests require verified session token or valid room permissions.
  - File modifications verify room existence and matching `roomId`.

### 3.7 Graceful Shutdown & Health Probes
- Workers and servers register `SIGTERM` and `SIGINT` handlers:
  1. Stop accepting new jobs from BullMQ queue.
  2. Finish or cancel active running containers.
  3. Clean workspace directories.
  4. Close Redis and database connection pools.
  5. Exit cleanly with code 0.
- Health Probes:
  - `/health`: Liveness probe (returns HTTP 200).
  - `/ready`: Readiness probe (verifies PostgreSQL and Redis connectivity).
