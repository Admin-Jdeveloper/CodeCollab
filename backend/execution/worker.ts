import { Worker, type Job } from "bullmq";
import { redisConnectionOptions, createRedisClient } from "../redis";
import { prisma } from "../db";
import { EXECUTION_QUEUE_NAME } from "./queue";
import { ExecutionService } from "./ExecutionService";
import { ExecutionRateLimiter } from "./rateLimiter";
import type { ExecutionJobData, ExecutionResult } from "./types";

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 3;

console.log(`[Worker:${WORKER_ID}] 🚀 Initializing execution worker (concurrency: ${CONCURRENCY})...`);

const pubClient = createRedisClient("worker-pub");
const subClient = createRedisClient("worker-sub");
const rateLimiter = new ExecutionRateLimiter(pubClient);

// ── Listen for cancellation signals ──────────────────────────
subClient.subscribe("execution-cancellation", (err) => {
  if (err) {
    console.error(`[Worker:${WORKER_ID}] Cancellation subscription error:`, err.message);
  }
});

subClient.on("message", async (channel, msg) => {
  if (channel === "execution-cancellation") {
    try {
      const { executionId } = JSON.parse(msg);
      if (executionId) {
        console.log(`[Worker:${WORKER_ID}] Received cancellation for ${executionId}`);
        await ExecutionService.cancel(executionId);
      }
    } catch {}
  }
});

// ── Job Processor ─────────────────────────────────────────────
async function processExecutionJob(job: Job<ExecutionJobData>): Promise<ExecutionResult> {
  const { executionId, roomId, userId, language, sourceCode, stdin } = job.data;
  console.log(`[Worker:${WORKER_ID}] ⚡ Starting execution ${executionId} (${language})...`);

  // 1. Mark RUNNING in Redis (TTL: 1 hour)
  try {
    const raw = await pubClient.get(`exec:${executionId}`);
    const current = raw ? JSON.parse(raw) : { id: executionId, language, roomId, userId };
    current.status = "RUNNING";
    current.workerId = WORKER_ID;
    current.startedAt = new Date().toISOString();
    await pubClient.setex(`exec:${executionId}`, 3600, JSON.stringify(current));
  } catch (e: any) {
    console.warn(`[Worker:${WORKER_ID}] Redis update to RUNNING warning:`, e.message);
  }

  // 2. Publish EXECUTION_STARTED
  if (roomId) {
    pubClient.publish(
      "execution-events",
      JSON.stringify({
        roomId,
        eventType: "EXECUTION_STARTED",
        data: {
          executionId,
          userId: job.data.userId,
          status: "RUNNING",
          workerId: WORKER_ID,
          startedAt: new Date().toISOString(),
        },
      })
    );
  }

  // Track active execution in rate limiter
  const userKey = userId || "anonymous";
  await rateLimiter.incrementActive(userKey);

  let result: ExecutionResult;

  try {
    // 3. Execute in Docker sandbox
    result = await ExecutionService.execute(job.data);
  } catch (err: any) {
    result = {
      status: "FAILED",
      stdout: "",
      stderr: `Worker execution error: ${err.message}`,
      compilerLog: "",
      exitCode: 1,
      executionTimeMs: 0,
      errorMessage: err.message,
    };
  } finally {
    await rateLimiter.decrementActive(userKey);
  }

  // Check if execution was cancelled while running
  try {
    const raw = await pubClient.get(`exec:${executionId}`);
    if (raw) {
      const current = JSON.parse(raw);
      if (current?.status === "CANCELLED") {
        result.status = "CANCELLED";
      } else if (current?.status === "COMPLETED" || current?.status === "FAILED") {
        console.log(`[Worker:${WORKER_ID}] Job ${executionId} already finalized as ${current.status}. Idempotent skip.`);
        return result;
      }
    }
  } catch {}

  // 4. Persist result in Redis (TTL: 1 hour)
  try {
    const raw = await pubClient.get(`exec:${executionId}`);
    const current = raw ? JSON.parse(raw) : { id: executionId };
    current.status = result.status;
    current.stdout = result.stdout;
    current.stderr = result.stderr;
    current.compilerLog = result.compilerLog;
    current.exitCode = result.exitCode;
    current.executionTimeMs = result.executionTimeMs;
    current.completedAt = new Date().toISOString();
    current.errorMessage = result.errorMessage;
    await pubClient.setex(`exec:${executionId}`, 3600, JSON.stringify(current));
  } catch (err: any) {
    console.error(`[Worker:${WORKER_ID}] Redis result save error:`, err.message);
  }

  // 5. Publish completion event to Redis Pub/Sub
  if (roomId) {
    pubClient.publish(
      "execution-events",
      JSON.stringify({
        roomId,
        eventType: `EXECUTION_${result.status}`,
        data: {
          executionId,
          userId: job.data.userId,
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
          compilerLog: result.compilerLog,
          exitCode: result.exitCode,
          executionTimeMs: result.executionTimeMs,
          errorMessage: result.errorMessage,
          completedAt: new Date().toISOString(),
        },
      })
    );
  }

  console.log(`[Worker:${WORKER_ID}] ✅ Finished execution ${executionId} -> ${result.status} (${result.executionTimeMs}ms)`);
  return result;
}

// ── BullMQ Worker Instance ───────────────────────────────────
export const worker = new Worker<ExecutionJobData, ExecutionResult>(
  EXECUTION_QUEUE_NAME,
  processExecutionJob,
  {
    connection: redisConnectionOptions,
    concurrency: CONCURRENCY,
    lockDuration: 90000,
  }
);

worker.on("ready", () => {
  console.log(`[Worker:${WORKER_ID}] 🟢 Worker connected and listening for jobs on queue "${EXECUTION_QUEUE_NAME}"`);
});

worker.on("error", (err) => {
  console.error(`[Worker:${WORKER_ID}] 🔴 Worker error:`, err.message);
});

// ── Graceful Shutdown ─────────────────────────────────────────
async function gracefulShutdown(signal: string) {
  console.log(`[Worker:${WORKER_ID}] Received ${signal}. Gracefully shutting down...`);
  try {
    await worker.close();
    await pubClient.quit();
    await subClient.quit();
    await prisma.$disconnect();
    console.log(`[Worker:${WORKER_ID}] Shutdown complete. Exiting.`);
    process.exit(0);
  } catch (err: any) {
    console.error(`[Worker:${WORKER_ID}] Error during shutdown:`, err.message);
    process.exit(1);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
