# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- Developers and engineering peers conducting paired programming and collaborative architecture/debugging.
- Technical interviewers and candidates carrying out live real-time coding evaluations.
- Students and educators teaching and practicing algorithmic programming in interactive shared labs.

## Product Purpose
CodeCollab empowers developers to collaboratively write, inspect, version, and execute code in real time without local setup, environment drift, or security compromises. Success means peers can open a room URL, immediately co-edit across multiple files with Monaco-grade ergonomics, see live peer presence, commit milestones with instant rollback, and execute untrusted user code in isolated Docker sandboxes across C, C++, Python, JavaScript, and TypeScript.

## Positioning
A zero-setup collaborative IDE combining Monaco editing, server-authoritative document versioning, instant Docker sandbox execution (C, C++, Python, JS, TS), and Git-like workspace milestone snapshots — without requiring heavy microservices or desktop installations.

## Operating Context
- Web browsers across desktop screens (primary) with responsive tablet/laptop adaptability.
- Dual-pane workflow: Left navigation (file tree, version control history, discussion chat), central full-featured Monaco code editor with multi-tab workspace, bottom collapsible terminal panel with live compiler diagnostics and output streams.
- Live collaborative sessions where multiple participants simultaneously edit, run code, and observe results.

## Capabilities and Constraints
- Multi-file workspace management with real-time file creation, renaming, and deletion.
- Real-time collaborative synchronization powered by Socket.IO and `@socket.io/redis-adapter`.
- Server-authoritative document versioning: rejects stale updates with `SYNC_REQUIRED` reconciliation.
- Ephemeral transient presence with peer avatar badges, live status dots, and cursor position tracking (no permanent database storage for cursors).
- Native execution pipeline via BullMQ queues and stateless worker fleet running restricted ephemeral Docker containers (`--network none`, 256MB RAM, 1.0 CPU, 64 PIDs, compile/execution timeouts, and 64KB output caps).
- Git-like version control: snapshot commits with multi-file JSON trees, diff viewer, and instant rollback.
- In-room chat stream and export capabilities.
- Rate-limited and authenticated API layer with PostgreSQL persistent state.

## Brand Commitments
- Name: **CodeCollab**
- Tone: High-performance, modern, developer-centric, clean, focused, distraction-free.
- Visual Foundation: Curated dark/light theme palette, monospace precision (JetBrains Mono), clean typography (Inter / Plus Jakarta Sans), crisp border contrasts, smooth transitions, and distinct connection states (🟢 Connected, 🟡 Reconnecting, 🔴 Connection lost).

## Evidence on Hand
- Full Next.js 15 App Router frontend (`frontend/src`).
- Bun / Express REST API and Socket.IO cluster backend (`backend/index.ts`, `backend/socket-server.ts`).
- PostgreSQL schema with User, Room, File, Commit, Message, and Execution models (`backend/prisma/schema.prisma`).
- BullMQ queue and stateless Docker worker fleet (`backend/execution/`).
- Multi-language sandbox container (`docker/Dockerfile.runner`).
- Automated test suites for execution, collaboration, scaling, and clustering (`tests/`).

## Product Principles
1. **Zero-Friction Collaboration**: Any developer can open a link and code together within seconds without installation or configuration hurdles.
2. **Absolute Sandboxing & Security**: User code is treated as untrusted and strictly isolated inside network-disabled, resource-capped Docker containers.
3. **Server-Authoritative Truth**: Prevent phantom edits, race conditions, and silent data loss through monotonic document versioning and optimistic synchronization.
4. **Resilient Execution Lifecycle**: Browser disconnects, network hiccups, or tab closures never terminate background runs or lose execution history.
5. **Ergonomic Craft**: The editor, terminal, and file explorer feel as snappy, responsive, and tactile as a native desktop developer tool.

## Accessibility & Inclusion
- High-contrast syntax highlighting supporting both dark and light modes.
- Full keyboard navigability across editor tabs, terminal drawers, and dialogs.
- Clear visual status cues (color + textual labels) for connection states, test outcomes, and execution status.
