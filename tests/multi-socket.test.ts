import { io, type Socket } from "socket.io-client";
import { spawn, execSync, type ChildProcess } from "node:child_process";

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function connectSocket(url: string, retries = 5): Promise<Socket> {
  for (let i = 0; i < retries; i++) {
    try {
      const s = await new Promise<Socket>((resolve, reject) => {
        const sock = io(url, {
          transports: ["websocket", "polling"],
          reconnection: false,
          timeout: 4000,
        });
        sock.on("connect", () => resolve(sock));
        sock.on("connect_error", (err) => reject(err));
      });
      return s;
    } catch {
      await wait(600);
    }
  }
  throw new Error(`Failed to connect to ${url} after ${retries} attempts`);
}

async function runMultiSocketTest() {
  console.log("=================================================");
  console.log("   RUNNING MULTI-SOCKET.IO CLUSTER TEST SUITE   ");
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

  const redisUrl =
    process.env.CLOUD_REDIS_URL ||
    "redis://default:FD8mJTm7FM8K9QkRB0NLF5mgnYDPXmGx@touchable-simple-pest-36749.db.redis.io:14692";

  let server1Proc: ChildProcess | null = null;
  let server2Proc: ChildProcess | null = null;
  let socket1: Socket | null = null;
  let socket2: Socket | null = null;

  try {
    // 1. Ensure Instance 1 is running on port 3001
    try {
      socket1 = await connectSocket("http://localhost:3001");
    } catch {
      console.log("  Spawning first Socket.IO instance on port 3001...");
      server1Proc = spawn("bun", ["socket-server.ts"], {
        cwd: "./backend",
        env: { ...process.env, SOCKET_PORT: "3001", REDIS_URL: redisUrl },
        shell: true,
      });
      const readyPromise1 = new Promise<void>((resolve) => {
        server1Proc!.stdout?.on("data", (data) => {
          if (data.toString().includes("Sync server running on port")) resolve();
        });
      });
      await Promise.race([readyPromise1, wait(6000)]);
      socket1 = await connectSocket("http://localhost:3001");
    }

    // 2. Spawn Instance 2 on port 3002
    console.log("  Spawning second Socket.IO instance on port 3002...");
    server2Proc = spawn("bun", ["socket-server.ts"], {
      cwd: "./backend",
      env: { ...process.env, SOCKET_PORT: "3002", REDIS_URL: redisUrl },
      shell: true,
    });
    const readyPromise2 = new Promise<void>((resolve) => {
      server2Proc!.stdout?.on("data", (data) => {
        if (data.toString().includes("Sync server running on port")) resolve();
      });
    });
    await Promise.race([readyPromise2, wait(6000)]);

    socket2 = await connectSocket("http://localhost:3002");

    assert(socket1.connected && socket2.connected, "Connected Client 1 to Port 3001 and Client 2 to Port 3002");

    const testRoom = `cluster-room-${Date.now()}`;

    const waitFor = async (fn: () => boolean, maxMs = 4500) => {
      const start = Date.now();
      while (!fn() && Date.now() - start < maxMs) {
        await wait(50);
      }
    };

    let socket1RoomReady = false;
    let socket2RoomReady = false;
    socket1.once("room_state", () => { socket1RoomReady = true; });
    socket2.once("room_state", () => { socket2RoomReady = true; });

    // Join both to same room on different cluster nodes
    socket1.emit("join_room", { roomId: testRoom, userId: "user-cluster-1", userName: "Alice-Node1" });
    socket2.emit("join_room", { roomId: testRoom, userId: "user-cluster-2", userName: "Bob-Node2" });

    await waitFor(() => socket1RoomReady && socket2RoomReady, 5000);

    // 3. Test cross-instance code update via Redis adapter & doc-sync
    let node2ReceivedUpdate = false;
    socket2.on("code_update", (payload: any) => {
      if (payload.content === 'console.log("Cluster broadcast via Redis adapter");') {
        node2ReceivedUpdate = true;
      }
    });

    socket1.emit("code_change", {
      roomId: testRoom,
      filePath: "/main.js",
      version: 1,
      content: 'console.log("Cluster broadcast via Redis adapter");',
      senderId: "user-cluster-1",
    });

    await waitFor(() => node2ReceivedUpdate, 4000);
    assert(
      node2ReceivedUpdate,
      "Cross-node event broadcast: Node 1 (3001) propagated edit to Node 2 (3002) via Redis adapter"
    );

    // 4. Test cross-instance cursor presence via Redis adapter
    let node1ReceivedCursor = false;
    socket1.on("cursor_update", (payload: any) => {
      if (payload.userId === "user-cluster-2" && payload.cursor.lineNumber === 99) {
        node1ReceivedCursor = true;
      }
    });

    socket2.emit("cursor_update", {
      roomId: testRoom,
      filePath: "/main.js",
      cursor: { lineNumber: 99, column: 15 },
    });

    await waitFor(() => node1ReceivedCursor, 3000);
    assert(
      node1ReceivedCursor,
      "Cross-node cursor broadcast: Node 2 (3002) propagated cursor to Node 1 (3001) via Redis adapter"
    );

  } catch (err: any) {
    assert(false, "Cluster test exception", err.message);
  } finally {
    socket1?.disconnect();
    socket2?.disconnect();
    const killProc = (proc: ChildProcess | null) => {
      if (!proc) return;
      if (process.platform === "win32") {
        try { if ((proc as any).pid) execSync(`taskkill /pid ${(proc as any).pid} /T /F`, { stdio: "ignore" }); } catch {}
      } else {
        try { proc.kill("SIGKILL"); } catch {}
      }
    };
    killProc(server1Proc);
    killProc(server2Proc);
  }

  console.log("\n-------------------------------------------------");
  console.log(`TOTAL MULTI-SOCKET TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("-------------------------------------------------");

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runMultiSocketTest();
