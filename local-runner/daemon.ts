/**
 * CodeCollab Execution Daemon / Worker Entry Point
 * 
 * Runs as a stateless BullMQ worker consuming jobs from Redis
 * and executing user code inside isolated Docker sandboxes.
 * 
 * Usage:
 *   bun run daemon
 *   or:
 *   bun run local-runner/daemon.ts
 */

import "../backend/execution/worker";
