import { prisma } from "../backend/db";

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runPersistenceOrderTests() {
  console.log("=================================================");
  console.log("   RUNNING OUT-OF-ORDER PERSISTENCE TEST SUITE   ");
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

  const roomId = `persist-room-${Date.now()}`;
  const filePath = "/persist-test.js";

  try {
    // 1. Setup Room & Initial File at Version 5
    await prisma.room.create({
      data: {
        id: roomId,
        title: "Persistence Test Room",
        language: "javascript",
        code: "// Initial v5",
      },
    });

    const initialFile = await prisma.file.create({
      data: {
        roomId,
        path: filePath,
        name: "persist-test.js",
        content: "const version = 5;",
        language: "javascript",
        version: 5,
      },
    });

    assert(initialFile.version === 5, "Initial database record seeded at version 5");

    // 2. Simulate Out-of-Order Writes:
    // Write Newer: version 6 with content "const version = 6; // NEWER"
    // Write Stale: version 4 with content "const version = 4; // STALE OVERWRITE"
    // Write Stale completes AFTER Write Newer has already committed version 6!

    // Step A: Newer write commits version 6
    const updatedNewer = await prisma.file.updateMany({
      where: {
        roomId,
        path: filePath,
        version: { lte: 6 },
      },
      data: {
        content: "const version = 6; // NEWER",
        version: 6,
      },
    });

    assert(updatedNewer.count === 1, "Newer write successfully updated database to version 6");

    // Step B: Delayed stale write finishes now, attempting to write version 4
    const staleWriteAttempt = await prisma.file.updateMany({
      where: {
        roomId,
        path: filePath,
        version: { lte: 4 }, // Conditional update guard
      },
      data: {
        content: "const version = 4; // STALE OVERWRITE",
        version: 4,
      },
    });

    assert(
      staleWriteAttempt.count === 0,
      "Delayed stale write (v4) affected 0 rows due to version { lte: 4 } conditional guard"
    );

    // Step C: Verify database content did NOT regress
    const dbRecordAfterStale = await prisma.file.findUnique({
      where: { roomId_path: { roomId, path: filePath } },
    });

    assert(
      dbRecordAfterStale?.version === 6,
      `Database version remained 6 (actual: ${dbRecordAfterStale?.version})`
    );
    assert(
      dbRecordAfterStale?.content === "const version = 6; // NEWER",
      `Database content did not regress to stale text (content: "${dbRecordAfterStale?.content}")`
    );

    // 3. Subsequent valid write at Version 7 succeeds cleanly
    const updatedNext = await prisma.file.updateMany({
      where: {
        roomId,
        path: filePath,
        version: { lte: 7 },
      },
      data: {
        content: "const version = 7; // PROGRESS",
        version: 7,
      },
    });

    assert(updatedNext.count === 1, "Subsequent monotonic write (v7) accepted and committed");

    const finalRecord = await prisma.file.findUnique({
      where: { roomId_path: { roomId, path: filePath } },
    });
    assert(
      finalRecord?.version === 7 && finalRecord.content === "const version = 7; // PROGRESS",
      "Authoritative persistence monotonically advanced to version 7"
    );

  } catch (err: any) {
    assert(false, "Persistence test exception", err.message);
  } finally {
    // Cleanup test data
    try {
      await prisma.file.deleteMany({ where: { roomId } });
      await prisma.room.deleteMany({ where: { id: roomId } });
      await prisma.$disconnect();
    } catch {}
  }

  console.log("\n-------------------------------------------------");
  console.log(`TOTAL PERSISTENCE TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("-------------------------------------------------");

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runPersistenceOrderTests();
