# CodeCollab — Developer Startup Guide

## Architecture Overview

```
Frontend  (Next.js, port 3003) ←──────────────────────────────────→ Browser
              │                                                         │
              │ REST API calls                     Socket.io (WS/poll) │
              ↓                                                         │
Backend REST  (Bun/Express, port 3000)                                  │
              │                                                         │
              └──── Prisma ────→ PostgreSQL                             │
                                                                        │
Socket Server (Bun/Socket.io, port 3001) ←──────────────────────────╯
              │
              └──── Prisma ────→ PostgreSQL
```

## Quick Start

### 1. Database (PostgreSQL)
Ensure PostgreSQL is running and `codeduo` database exists:
```sql
CREATE DATABASE codeduo;
```

Run Prisma migration from `/backend`:
```bash
cd backend
.\node_modules\.bin\prisma.exe migrate dev --name init
```

### 2. Backend REST API (Port 3000)
```bash
cd backend
bun run dev
```

### 3. Socket.io Sync Server (Port 3001)
Open a new terminal:
```bash
cd backend
bun run dev:socket
```

### 4. Frontend (Port 3003)
Open a new terminal:
```bash
cd frontend
bun run dev
```

### 5. Local Execution Daemon (Port 4000, Optional for Native G++/Python)
Run code natively and decentralized on your local machine:
```bash
bun run daemon
```
*Note: If the daemon is not running, CodeCollab automatically falls back to in-browser execution via Web Workers (JS) and Pyodide WebAssembly (Python).*

Then open **http://localhost:3003** in your browser.

## Testing Multi-User Sync

1. Create a room at http://localhost:3003
2. Copy the room invite link (click the room ID badge)
3. Open the link in a second browser tab or incognito window
4. Log in as `alice@codecollab.dev` in one tab, `bob@codecollab.dev` in the other (password: `password123`)
5. Type code in either editor — changes propagate in real-time
6. Observe the cursor position indicator appear for the peer
7. Send chat messages in the Discussion panel — they broadcast instantly
8. Test local execution by clicking **Run** — compiler diagnostics map to code lines

## Port Map
| Service | Port | Description |
|---|---|---|
| Next.js Frontend | 3003 | Web workspace & UI |
| Express REST API | 3000 | Auth, rooms, persistence |
| Socket.io Sync Server | 3001 | Real-time code & chat sync |
| Local Execution Daemon | 4000 | Native localized compilation & runner |
| PostgreSQL | 5432 | Database |
