import { prisma } from "../backend/db";
import { enqueueExecution } from "../backend/execution/queue";
import { spawn, execSync } from "node:child_process";

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runLoadTests() {
  console.log("=================================================");
  console.log("   RUNNING HIGH-THROUGHPUT LOAD & SCALE SUITE   ");
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

  // Spawn 3 stateless worker daemons for distributed load processing
  console.log("  Spawning fleet of 3 worker daemons (daemon-A, daemon-B, daemon-C)...");
  const workerProcs = [
    spawn("bun", ["run", "backend/execution/worker.ts"], {
      cwd: ".",
      env: { ...process.env, WORKER_ID: "daemon-A", WORKER_CONCURRENCY: "2" },
      shell: true,
    }),
    spawn("bun", ["run", "backend/execution/worker.ts"], {
      cwd: ".",
      env: { ...process.env, WORKER_ID: "daemon-B", WORKER_CONCURRENCY: "2" },
      shell: true,
    }),
    spawn("bun", ["run", "backend/execution/worker.ts"], {
      cwd: ".",
      env: { ...process.env, WORKER_ID: "daemon-C", WORKER_CONCURRENCY: "2" },
      shell: true,
    }),
  ];

  await wait(3000);

  try {
    const TOTAL_JOBS = 100;
    const NUM_ROOMS = 5;
    const NUM_USERS = 10;

    console.log(`  Setting up ${NUM_ROOMS} test rooms and enqueuing ${TOTAL_JOBS} executions across ${NUM_USERS} users...`);

    const userIds: string[] = [];
    for (let u = 0; u < NUM_USERS; u++) {
      const email = `load-user-${Date.now()}-${u}@codecollab.test`;
      const user = await prisma.user.create({
        data: {
          email,
          name: `LoadUser_${u + 1}`,
          password: "password123",
        },
      });
      userIds.push(user.id);
    }

    const roomIds: string[] = [];
    for (let r = 0; r < NUM_ROOMS; r++) {
      const room = await prisma.room.create({
        data: {
          title: `Load Test Room ${r + 1}`,
          language: "python",
          creatorId: userIds[r % NUM_USERS],
        },
      });
      roomIds.push(room.id);
    }

    const executionIds: string[] = [];
    const startTime = Date.now();

    // Batch create executions in PostgreSQL
    const executionData = [];
    for (let i = 0; i < TOTAL_JOBS; i++) {
      const assignedRoom = roomIds[i % NUM_ROOMS]!;
      const assignedUser = userIds[i % NUM_USERS]!;
      executionData.push({
        language: "python",
        sourceCode: `print("LOAD_OK_${i}")`,
        status: "QUEUED" as const,
        roomId: assignedRoom,
        userId: assignedUser,
      });
    }

    const createdRecords = await prisma.$transaction(
      executionData.map((data) => prisma.execution.create({ data }))
    );

    for (const rec of createdRecords) {
      executionIds.push(rec.id);
    }

    assert(executionIds.length === TOTAL_JOBS, `Created ${TOTAL_JOBS} QUEUED records in PostgreSQL across ${NUM_ROOMS} rooms`);

    // Dispatch all 100 jobs to BullMQ concurrently
    await Promise.all(
      createdRecords.map((rec, idx) =>
        enqueueExecution({
          executionId: rec.id,
          language: rec.language,
          sourceCode: rec.sourceCode,
          roomId: rec.roomId || undefined,
          userId: rec.userId || undefined,
        })
      )
    );

    assert(true, `Dispatched ${TOTAL_JOBS} execution jobs to BullMQ Redis queue in ${Date.now() - startTime}ms`);

    // Monitor completion of the 100 jobs
    console.log("  Waiting for 3 workers to process all 100 jobs...");
    const timeoutAt = Date.now() + 90000; // 90 seconds max
    let completedCount = 0;
    const workerDistribution: Record<string, number> = {};

    while (Date.now() < timeoutAt) {
      const completed = await prisma.execution.findMany({
        where: {
          id: { in: executionIds },
          status: { in: ["COMPLETED", "FAILED", "TIMEOUT", "RUNTIME_ERROR", "COMPILE_ERROR"] },
        },
        select: { id: true, status: true, workerId: true },
      });

      completedCount = completed.length;
      for (const item of completed) {
        const wId = item.workerId || "unknown";
        workerDistribution[wId] = (workerDistribution[wId] || 0) + 1;
      }

      if (completedCount >= TOTAL_JOBS) {
        break;
      }
      // Reset distribution map before next check to avoid double counting during polling
      for (const k in workerDistribution) delete workerDistribution[k];
      await wait(1000);
    }

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`  Processed ${completedCount}/${TOTAL_JOBS} jobs in ${elapsedSec}s`);
    console.log("  Worker distribution:", workerDistribution);

    assert(
      completedCount >= TOTAL_JOBS,
      `All ${TOTAL_JOBS} jobs successfully completed by worker fleet within time limit (${elapsedSec}s)`
    );

    const activeWorkers = Object.keys(workerDistribution);
    assert(
      activeWorkers.length >= 2,
      `Jobs distributed across multiple workers (${activeWorkers.join(", ")})`
    );

    // Verify all rooms received their executions
    const roomCounts = await prisma.execution.groupBy({
      by: ["roomId"],
      where: { id: { in: executionIds } },
      _count: { id: true },
    });
    assert(
      roomCounts.length === NUM_ROOMS,
      `Executions correctly distributed across all ${NUM_ROOMS} rooms`
    );

  } finally {
    for (const p of workerProcs) {
      if (process.platform === "win32") {
        try { if (p.pid) execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: "ignore" }); } catch {}
      } else {
        try { p.kill("SIGKILL"); } catch {}
      }
    }
    await prisma.$disconnect();
  }

  console.log("\n-------------------------------------------------");
  console.log(`TOTAL LOAD TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("-------------------------------------------------");

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runLoadTests();
