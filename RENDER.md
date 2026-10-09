# CodeCollab: Render Deployment Guide (Two-Service Architecture)

This guide documents deploying the CodeCollab backend as **two separate Render Web Services**:
1. **Service A (REST API)**: `codecollab-api`
2. **Service B (Socket.IO Real-Time Sync)**: `codecollab-socket`

---

## 1. Architecture Overview

```
                      ┌──────────────────────┐
                      │  Frontend (Vercel)   │
                      └──────────┬───────────┘
                                 │
             ┌───────────────────┴───────────────────┐
             │ HTTPS (REST)                          │ WSS (Socket.IO)
             ▼                                       ▼
  ┌──────────────────────┐               ┌──────────────────────┐
  │ Render Web Service A │               │ Render Web Service B │
  │   codecollab-api     │               │  codecollab-socket   │
  └──────────┬───────────┘               └──────────┬───────────┘
             │                                      │
             │           ┌──────────────┐           │
             ├──────────►│ PostgreSQL   │◄──────────┤
             │           └──────────────┘           │
             │           ┌──────────────┐           │
             └──────────►│    Redis     │◄──────────┘
                         └──────┬───────┘
                                │ (Job Queue)
                                ▼
                         ┌──────────────┐
                         │ Execution    │
                         │ Worker (VM)  │
                         └──────────────┘
```

---

## Option 1: Instant Deployment via Render Blueprint (`render.yaml`)

1. Connect your GitHub repository to [Render](https://dashboard.render.com).
2. Click **New +** $\rightarrow$ **Blueprint**.
3. Select this repository. Render automatically reads [render.yaml](file:///f:/anti/26-june-leetcode-v0-assignment-main/render.yaml) and configures both services:
   - `codecollab-api` (REST API)
   - `codecollab-socket` (Socket.IO Server)
4. Fill in the sensitive environment variables when prompted:
   - `DATABASE_URL`: PostgreSQL connection string (Supabase / Render PostgreSQL)
   - `REDIS_URL`: Redis connection string (Render Redis / Upstash / Redis Cloud)
5. Click **Apply**.

---

## Option 2: Manual Service Creation via Render Dashboard

If you prefer configuring services manually in the Render dashboard:

### Service A: REST API (`codecollab-api`)
1. In Render Dashboard, click **New +** $\rightarrow$ **Web Service**.
2. Select your repository.
3. Configure the following parameters:
   - **Name**: `codecollab-api`
   - **Language / Runtime**: `Bun`
   - **Root Directory**: `backend`
   - **Build Command**: `bun install && bun run db:generate`
   - **Pre-Deploy Command**: `bun run db:migrate`
   - **Start Command**: `bun run start`
   - **Health Check Path**: `/health`
4. Set Environment Variables:
   - `NODE_ENV`: `production`
   - `DATABASE_URL`: `postgresql://user:password@host:5432/postgres`
   - `REDIS_URL`: `rediss://default:password@host:port`
   - `CORS_ORIGIN`: `*` (or your frontend domain, e.g. `https://your-app.vercel.app`)

### Service B: Socket.IO Server (`codecollab-socket`)
1. Click **New +** $\rightarrow$ **Web Service**.
2. Select your repository.
3. Configure the following parameters:
   - **Name**: `codecollab-socket`
   - **Language / Runtime**: `Bun`
   - **Root Directory**: `backend`
   - **Build Command**: `bun install && bun run db:generate`
   - **Start Command**: `bun run start:socket`
   - **Health Check Path**: `/health`
4. Set Environment Variables:
   - `NODE_ENV`: `production`
   - `DATABASE_URL`: `postgresql://user:password@host:5432/postgres`
   - `REDIS_URL`: `rediss://default:password@host:port`
   - `CORS_ORIGIN`: `*` (or your frontend domain)

---

## 3. Frontend Environment Configuration

Once both Render services are deployed, update your frontend environment variables (e.g. in Vercel project settings):

```env
# REST API endpoint (points to Service A)
NEXT_PUBLIC_BACKEND_URL=https://codecollab-api.onrender.com

# Socket.IO endpoint (points to Service B)
NEXT_PUBLIC_SOCKET_URL=https://codecollab-socket.onrender.com

# NextAuth secret & URL
AUTH_SECRET=your-secure-random-32-char-secret
NEXTAUTH_URL=https://your-frontend.vercel.app
```

---

## 4. Code Execution Worker Note

The code execution system relies on Docker sandboxing (`docker run ... codecollab-runner:latest`) via `/var/run/docker.sock`. Because Render Web Services do not support privileged Docker-in-Docker:

- Run the worker on any host with Docker daemon access:
  ```bash
  # Ensure REDIS_URL and DATABASE_URL match the production values
  bun run worker
  # or
  bun run daemon
  ```
- The worker is fully stateless and communicates solely via Redis BullMQ jobs and pub/sub channels.
