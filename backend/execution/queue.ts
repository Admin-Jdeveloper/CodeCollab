import { Queue } from "bullmq";
import { redisConnectionOptions, createRedisClient } from "../redis";
import type { ExecutionJobData } from "./types";
import { ExecutionService } from "./ExecutionService";
import { prisma } from "../db";

export const EXECUTION_QUEUE_NAME = "code-execution";

export const executionQueue = new Queue<ExecutionJobData>(EXECUTION_QUEUE_NAME, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 1, // Do not auto-retry user syntax errors; worker handles retry logic
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

const pubClient = createRedisClient("queue-pub");

export async function enqueueExecution(data: ExecutionJobData): Promise<void> {
  await executionQueue.add("run", data, {
    jobId: data.executionId,
  });

  // Broadcast EXECUTION_QUEUED
  if (data.roomId) {
    pubClient.publish(
      "execution-events",
      JSON.stringify({
        roomId: data.roomId,
        eventType: "EXECUTION_QUEUED",
        data: {
          executionId: data.executionId,
          userId: data.userId,
          status: "QUEUED",
          language: data.language,
          createdAt: new Date().toISOString(),
        },
      })
    );
  }
}

export async function cancelExecutionJob(executionId: string, roomId?: string): Promise<boolean> {
  // 1. Remove from BullMQ queue if still queued
  try {
    const job = await executionQueue.getJob(executionId);
    if (job) {
      await job.remove();
    }
  } catch {}

  // 2. Publish cancellation broadcast over Redis to workers
  pubClient.publish(
    "execution-cancellation",
    JSON.stringify({ executionId, roomId })
  );

  // 3. Mark CANCELLED in Redis (TTL: 1 hour)
  try {
    const raw = await pubClient.get(`exec:${executionId}`);
    const current = raw ? JSON.parse(raw) : { id: executionId };
    current.status = "CANCELLED";
    current.completedAt = new Date().toISOString();
    await pubClient.setex(`exec:${executionId}`, 3600, JSON.stringify(current));
  } catch {}

  // 4. Kill local container if running on this node
  await ExecutionService.cancel(executionId);

  // 4. Broadcast event
  if (roomId) {
    pubClient.publish(
      "execution-events",
      JSON.stringify({
        roomId,
        eventType: "EXECUTION_CANCELLED",
        data: {
          executionId,
          status: "CANCELLED",
          completedAt: new Date().toISOString(),
        },
      })
    );
  }

  return true;
}
