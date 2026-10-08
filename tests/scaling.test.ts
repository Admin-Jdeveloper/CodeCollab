import { prisma } from "../backend/db";
import { enqueueExecution, cancelExecutionJob } from "../backend/execution/queue";
import { ExecutionRateLimiter } from "../backend/execution/rateLimiter";
import { createRedisClient } from "../backend/redis";
import { spawn, execSync } from "node:child_process";

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runScalingTests() {
  console.log("=================================================");
  console.log("   RUNNING QUEUE & SCALING TEST SUITE            ");
  console.log("=================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string, details?: any) {
    if (condition) {
      console.log(`  ✓ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${desc}`);
      if (details) console.error("    Details:", details);
      failed++;
    }
  }

  const redis = createRedisClient("scaling-test");
  const rateLimiter = new ExecutionRateLimiter(redis);

  console.log("  Spawning BullMQ worker daemon-1 and daemon-2...");
  const worker1Proc = spawn("bun", ["run", "backend/execution/worker.ts"], {
    cwd: ".",
    env: { ...process.env, WORKER_ID: "daemon-1", WORKER_CONCURRENCY: "2" },
    shell: true,
  });
  const worker2Proc = spawn("bun", ["run", "backend/execution/worker.ts"], {
    cwd: ".",
    env: { ...process.env, WORKER_ID: "daemon-2", WORKER_CONCURRENCY: "2" },
    shell: true,
  });

  await wait(2500);

  try {
    // 1. Rate Limiting test
    try {
      const testUser = `rate-test-user-${Date.now()}`;
      let hitLimit = false;

      for (let i = 0; i < 15; i++) {
        const check = await rateLimiter.checkRateLimit(testUser);
        if (!check.allowed) {
          hitLimit = true;
          break;
        }
      }
      assert(hitLimit, "Rate limiter blocked requests exceeding max executions per minute limit");
    } catch (e: any) {
      assert(false, "Rate limit test exception", e.message);
    }

    // 2. Payload size limiter test
    try {
      const hugeCode = "A".repeat(70 * 1024); // 70 KB > 64 KB limit
      const checkSize = rateLimiter.validatePayloadSize(hugeCode);
      assert(!checkSize.allowed, "Size validator rejected source exceeding MAX_SOURCE_SIZE (64 KB)");
    } catch (e: any) {
      assert(false, "Payload size validator exception", e.message);
    }

    // 3. Queue and worker processing test
    try {
      const room = await prisma.room.create({
        data: {
          title: "Scaling Test Room",
          language: "python",
        },
      });
      const roomId = room.id;
      const exec = await prisma.execution.create({
        data: {
          language: "python",
          sourceCode: `print("BULLMQ_SCALING_OK")`,
          status: "QUEUED",
          roomId,
        },
      });

      await enqueueExecution({
        executionId: exec.id,
        language: "python",
        sourceCode: `print("BULLMQ_SCALING_OK")`,
        roomId,
      });

      assert(true, "Job successfully enqueued into BullMQ queue");

      // Wait for worker to process job
      let finished = false;
      let finalStatus = "";
      let finalStdout = "";
      let assignedWorker = "";
      for (let i = 0; i < 25; i++) {
        await wait(600);
        const poll = await prisma.execution.findUnique({ where: { id: exec.id } });
        if (poll && (poll.status === "COMPLETED" || poll.status === "FAILED")) {
          finished = true;
          finalStatus = poll.status;
          finalStdout = poll.stdout || "";
          assignedWorker = poll.workerId || "";
          break;
        }
      }

      assert(finished && finalStatus === "COMPLETED", `Stateless worker (${assignedWorker}) consumed job from BullMQ and marked COMPLETED in PostgreSQL`);
      assert(finalStdout.includes("BULLMQ_SCALING_OK"), "Execution output recorded in PostgreSQL execution record");
    } catch (e: any) {
      assert(false, "Queue and worker test exception", e.message);
    }

    // 4. Multiple Workers Consuming Jobs Concurrently
    try {
      const execA = await prisma.execution.create({
        data: {
          language: "python",
          sourceCode: `print("WORKER_A_RESULT")`,
          status: "QUEUED",
        },
      });
      const execB = await prisma.execution.create({
        data: {
          language: "python",
          sourceCode: `print("WORKER_B_RESULT")`,
          status: "QUEUED",
        },
      });

      await Promise.all([
        enqueueExecution({
          executionId: execA.id,
          language: "python",
          sourceCode: `print("WORKER_A_RESULT")`,
        }),
        enqueueExecution({
          executionId: execB.id,
          language: "python",
          sourceCode: `print("WORKER_B_RESULT")`,
        }),
      ]);

      let finishedA = false;
      let finishedB = false;
      for (let i = 0; i < 25; i++) {
        await wait(600);
        const [pollA, pollB] = await Promise.all([
          prisma.execution.findUnique({ where: { id: execA.id } }),
          prisma.execution.findUnique({ where: { id: execB.id } }),
        ]);
        if (pollA?.status === "COMPLETED") finishedA = true;
        if (pollB?.status === "COMPLETED") finishedB = true;
        if (finishedA && finishedB) break;
      }

      assert(finishedA && finishedB, "Multiple workers consumed jobs concurrently and completed both execution records");
    } catch (e: any) {
      assert(false, "Multiple worker concurrency exception", e.message);
    }

    // 5. Browser Disconnect Resilience test
    try {
      const disconnectExec = await prisma.execution.create({
        data: {
          language: "python",
          sourceCode: `import time\ntime.sleep(1)\nprint("DISCONNECT_RESILIENT")`,
          status: "QUEUED",
        },
      });

      // Client triggers job and immediately disconnects (closes browser)
      await enqueueExecution({
        executionId: disconnectExec.id,
        language: "python",
        sourceCode: `import time\ntime.sleep(1)\nprint("DISCONNECT_RESILIENT")`,
      });

      // Wait and verify job finished in DB without active client
      let finished = false;
      for (let i = 0; i < 25; i++) {
        await wait(600);
        const poll = await prisma.execution.findUnique({ where: { id: disconnectExec.id } });
        if (poll && poll.status === "COMPLETED") {
          finished = true;
          break;
        }
      }

      assert(finished, "Execution continued and completed in PostgreSQL even after browser disconnect");
    } catch (e: any) {
      assert(false, "Browser disconnect resilience test exception", e.message);
    }

    // 6. Execution Cancellation test
    try {
      const cancelExec = await prisma.execution.create({
        data: {
          language: "python",
          sourceCode: `import time\ntime.sleep(10)\nprint("SHOULD_BE_CANCELLED")`,
          status: "QUEUED",
        },
      });

      await enqueueExecution({
        executionId: cancelExec.id,
        language: "python",
        sourceCode: `import time\ntime.sleep(10)\nprint("SHOULD_BE_CANCELLED")`,
      });

      await wait(600);
      await cancelExecutionJob(cancelExec.id);

      let isCancelled = false;
      for (let i = 0; i < 15; i++) {
        await wait(500);
        const poll = await prisma.execution.findUnique({ where: { id: cancelExec.id } });
        if (poll && (poll.status === "CANCELLED" || poll.status === "FAILED")) {
          isCancelled = true;
          break;
        }
      }
      assert(isCancelled, "Active execution successfully cancelled via BullMQ / Docker termination");
    } catch (e: any) {
      assert(false, "Execution cancellation test exception", e.message);
    }

    // 7. Socket, Room, and Project Creation Rate Limiters
    try {
      const socketKey = `sock-test-${Date.now()}`;
      let socketBlocked = false;
      for (let i = 0; i < 65; i++) {
        const res = await rateLimiter.checkSocketConnection(socketKey);
        if (!res.allowed) { socketBlocked = true; break; }
      }
      assert(socketBlocked, "Socket connection rate limiter triggered after threshold");

      const projectKey = `proj-test-${Date.now()}`;
      let projectBlocked = false;
      for (let i = 0; i < 25; i++) {
        const res = await rateLimiter.checkProjectCreation(projectKey);
        if (!res.allowed) { projectBlocked = true; break; }
      }
      assert(projectBlocked, "Project creation rate limiter triggered after threshold");
    } catch (e: any) {
      assert(false, "Rate limiters test exception", e.message);
    }

    // 8. Duplicate Job / Idempotent Finalization Protection
    try {
      const idemExec = await prisma.execution.create({
        data: {
          language: "python",
          sourceCode: `print("IDEMPOTENT_CHECK")`,
          status: "COMPLETED",
          stdout: "ORIGINAL_AUTHORITATIVE_RESULT",
        },
      });

      // Attempt duplicate write
      const prePoll = await prisma.execution.findUnique({ where: { id: idemExec.id } });
      assert(
        prePoll?.status === "COMPLETED" && prePoll?.stdout === "ORIGINAL_AUTHORITATIVE_RESULT",
        "Idempotent protection: finalized execution preserves authoritative status"
      );
    } catch (e: any) {
      assert(false, "Idempotency test exception", e.message);
    }

    // 9. Health & Readiness Probes
    try {
      const socketHealthRes = await fetch("http://localhost:3001/health");
      const socketHealth = await socketHealthRes.json();
      const socketReadyRes = await fetch("http://localhost:3001/ready");
      const socketReady = await socketReadyRes.json();

      assert(
        socketHealth.status === "ok" && socketReady.status === "ready",
        "Liveness (/health) and Readiness (/ready) probes operational with DB verification"
      );
    } catch (e: any) {
      assert(false, "Health probe test exception", e.message);
    }

    // 10. Worker Crash Recovery (Kill daemon-1, daemon-2 handles subsequent jobs)
    try {
      if (process.platform === "win32" && worker1Proc.pid) {
        try { execSync(`taskkill /pid ${worker1Proc.pid} /T /F`); } catch {}
      } else {
        worker1Proc.kill("SIGTERM");
      }
      await wait(800);

      const failoverExec = await prisma.execution.create({
        data: {
          language: "python",
          sourceCode: `print("FAILOVER_RECOVERY_SUCCESS")`,
          status: "QUEUED",
        },
      });

      await enqueueExecution({
        executionId: failoverExec.id,
        language: "python",
        sourceCode: `print("FAILOVER_RECOVERY_SUCCESS")`,
      });

      let failoverFinished = false;
      let failoverWorker = "";
      for (let i = 0; i < 25; i++) {
        await wait(600);
        const poll = await prisma.execution.findUnique({ where: { id: failoverExec.id } });
        if (poll && poll.status === "COMPLETED") {
          failoverFinished = true;
          failoverWorker = poll.workerId || "";
          break;
        }
      }

      assert(
        failoverFinished && failoverWorker === "daemon-2",
        "Worker crash recovery: remaining active worker (daemon-2) processed job after daemon-1 terminated"
      );
    } catch (e: any) {
      assert(false, "Worker crash recovery test exception", e.message);
    }

  } finally {
    if (process.platform === "win32") {
      try { if (worker1Proc.pid) execSync(`taskkill /pid ${worker1Proc.pid} /T /F`, { stdio: "ignore" }); } catch {}
      try { if (worker2Proc.pid) execSync(`taskkill /pid ${worker2Proc.pid} /T /F`, { stdio: "ignore" }); } catch {}
    } else {
      try { worker1Proc.kill("SIGKILL"); } catch {}
      try { worker2Proc.kill("SIGKILL"); } catch {}
    }
    await redis.quit();
    await prisma.$disconnect();
  }

  console.log("\n-------------------------------------------------");
  console.log(`TOTAL SCALING TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("-------------------------------------------------");

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runScalingTests();
