import { io, type Socket } from "socket.io-client";
import { spawn, execSync } from "node:child_process";

const TEST_PORT = 3003;
const SOCKET_URL = `http://localhost:${TEST_PORT}`;

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function connectSocket(url: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(url, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 5000,
    });
    s.on("connect", () => resolve(s));
    s.on("connect_error", (err) => reject(err));
  });
}

async function runRapidTypingTestSuite() {
  console.log("=================================================");
  console.log("   RUNNING RAPID TYPING & PIPELINING TEST SUITE   ");
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

  // 1. Spawn a dedicated Socket.IO instance on port 3003
  console.log(`  Spawning test Socket.IO instance on port ${TEST_PORT}...`);
  const redisUrl =
    process.env.CLOUD_REDIS_URL ||
    "redis://default:FD8mJTm7FM8K9QkRB0NLF5mgnYDPXmGx@touchable-simple-pest-36749.db.redis.io:14692";

  const serverProc = spawn("bun", ["socket-server.ts"], {
    cwd: "./backend",
    env: { ...process.env, SOCKET_PORT: String(TEST_PORT), REDIS_URL: redisUrl },
    shell: true,
  });

  const readyPromise = new Promise<void>((resolve) => {
    serverProc.stdout?.on("data", (data) => {
      const str = data.toString();
      console.log(`[Server stdout]: ${str}`);
      if (str.includes("Sync server running on port")) {
        resolve();
      }
    });
  });

  serverProc.stderr?.on("data", (data) => {
    console.error(`[Server stderr]: ${data.toString()}`);
  });

  // Wait for server to start or maximum 6s
  await Promise.race([readyPromise, wait(6000)]);

  let client1: Socket | null = null;
  let client2: Socket | null = null;

  try {
    client1 = await connectSocket(SOCKET_URL);
    client2 = await connectSocket(SOCKET_URL);
    assert(client1.connected && client2.connected, `Both test clients connected to port ${TEST_PORT}`);

    const testRoom = `rapid-room-${Date.now()}`;
    const aliceRoomStatePromise = new Promise<any>((resolve) => client1!.once("room_state", resolve));
    const bobRoomStatePromise = new Promise<any>((resolve) => client2!.once("room_state", resolve));

    client1.emit("join_room", { roomId: testRoom, userId: "user-alice", userName: "Alice" });
    client2.emit("join_room", { roomId: testRoom, userId: "user-bob", userName: "Bob" });

    const [aliceState] = await Promise.all([aliceRoomStatePromise, bobRoomStatePromise]);
    const testFile = aliceState.files?.[0]?.path || "/main.js";
    const initialVersion = aliceState.files?.[0]?.version || 1;

    // Track acks, sync_required, and updates
    const client1Acks: number[] = [];
    let client1SyncRequiredCount = 0;
    const client2Updates: string[] = [];
    let client2SyncRequiredCount = 0;

    client1.on("code_ack", (ack: any) => {
      client1Acks.push(ack.version);
    });

    client1.on("sync_required", () => {
      client1SyncRequiredCount++;
    });

    client2.on("code_update", (p: any) => {
      if (p.filePath === testFile) {
        client2Updates.push(p.content);
      }
    });

    client2.on("sync_required", () => {
      client2SyncRequiredCount++;
    });

    // -------------------------------------------------------------
    // TEST 1: Rapid typing with pipelined in-flight edits
    // -------------------------------------------------------------
    console.log("\n[Test 1] Rapid typing simulation (10 rapid keystrokes with pipelined versions):");
    const typingSteps = [
      "c",
      "co",
      "con",
      "cons",
      "const",
      "const ",
      "const x",
      "const x ",
      "const x =",
      "const x = 42;",
    ];

    // Alice types rapidly: simulates typing without waiting for server ACKs
    // Local optimistic version increases with each emission
    let localVersion = initialVersion;
    for (let i = 0; i < typingSteps.length; i++) {
      const code = typingSteps[i];
      client1.emit("code_change", {
        roomId: testRoom,
        filePath: testFile,
        version: localVersion,
        content: code,
        senderId: "user-alice",
      });
      localVersion++;
      await wait(15); // 15ms interval — faster than network RTT
    }

    // Wait for all in-flight edits to be processed
    await wait(800);

    assert(
      client1SyncRequiredCount === 0,
      "Zero sync_required rejections received by typing user (no rollback trigger)"
    );

    assert(
      client1Acks.length === typingSteps.length,
      `All ${typingSteps.length} rapid keystrokes were acknowledged (received: ${client1Acks.length})`
    );

    // Verify monotonic version progression in ACKs
    let isMonotonic = true;
    for (let i = 1; i < client1Acks.length; i++) {
      if (client1Acks[i]! <= client1Acks[i - 1]!) {
        isMonotonic = false;
        break;
      }
    }
    assert(isMonotonic, `ACK versions grew strictly monotonically: ${client1Acks.join(" -> ")}`);

    // Verify Bob received latest update
    const lastBobUpdate = client2Updates[client2Updates.length - 1];
    assert(
      lastBobUpdate === "const x = 42;",
      `Peer (Bob) received final authoritative text: "${lastBobUpdate}"`
    );

    // -------------------------------------------------------------
    // TEST 2: Concurrent edit conflict detection
    // -------------------------------------------------------------
    console.log("\n[Test 2] Concurrent edit conflict detection from different peer:");

    // Bob tries to overwrite with an obsolete base version (version 1)
    client2.emit("code_change", {
      roomId: testRoom,
      filePath: testFile,
      version: 1, // STALE! Server is now at version 11
      content: "const y = 999; // STALE OVERWRITE",
      senderId: "user-bob",
    });

    await wait(500);

    assert(
      client2SyncRequiredCount === 1,
      "Server rejected stale edit from different user (Bob) and emitted sync_required"
    );

    // Verify Alice's document was NOT overwritten
    let finalContent = "";
    client1.on("file_state", (fs: any) => {
      finalContent = fs.content;
    });
    client1.emit("join_file", { roomId: testRoom, filePath: testFile });

    await wait(400);
    assert(
      finalContent === "const x = 42;",
      `Authoritative document preserved Alice's rapid typing ("${finalContent}")`
    );

  } catch (err: any) {
    assert(false, "Rapid typing test exception", err.message);
  } finally {
    client1?.disconnect();
    client2?.disconnect();
    if (process.platform === "win32") {
      try { if (serverProc.pid) execSync(`taskkill /pid ${serverProc.pid} /T /F`, { stdio: "ignore" }); } catch {}
    } else {
      try { serverProc.kill("SIGKILL"); } catch {}
    }
  }

  console.log("\n-------------------------------------------------");
  console.log(`TOTAL RAPID TYPING TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("-------------------------------------------------");

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runRapidTypingTestSuite();
