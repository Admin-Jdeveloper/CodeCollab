import { io, type Socket } from "socket.io-client";
import { spawn, execSync } from "node:child_process";

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

  // 1. Spawn a second Socket.IO server on port 3002
  console.log("  Spawning second Socket.IO instance on port 3002...");
  const server2Proc = spawn("bun", ["socket-server.ts"], {
    cwd: "./backend",
    env: { ...process.env, SOCKET_PORT: "3002" },
    shell: true,
  });

  server2Proc.stdout?.on("data", (data) => {
    // console.log(`[Server 2 stdout]: ${data}`);
  });
  server2Proc.stderr?.on("data", (data) => {
    console.error(`[Server 2 stderr]: ${data}`);
  });

  await wait(3000);

  let socket1: Socket | null = null;
  let socket2: Socket | null = null;

  try {
    // 2. Connect client 1 to instance on port 3001, client 2 to instance on port 3002
    socket1 = await connectSocket("http://localhost:3001");
    socket2 = await connectSocket("http://localhost:3002");

    assert(socket1.connected && socket2.connected, "Connected Client 1 to Port 3001 and Client 2 to Port 3002");

    const testRoom = `cluster-room-${Date.now()}`;

    // Join both to same room on different cluster nodes
    socket1.emit("join_room", { roomId: testRoom, userId: "user-cluster-1", userName: "Alice-Node1" });
    socket2.emit("join_room", { roomId: testRoom, userId: "user-cluster-2", userName: "Bob-Node2" });

    await wait(600);

    // 3. Test cross-instance code update via Redis adapter
    let node2ReceivedUpdate = false;
    socket2.on("code_update", (payload: any) => {
      if (payload.content === 'console.log("Cluster broadcast via Redis adapter");') {
        node2ReceivedUpdate = true;
      }
    });

    socket1.emit("code_change", {
      roomId: testRoom,
      filePath: "/cluster.js",
      version: 1,
      content: 'console.log("Cluster broadcast via Redis adapter");',
      senderId: "user-cluster-1",
    });

    await wait(800);
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
      filePath: "/cluster.js",
      cursor: { lineNumber: 99, column: 15 },
    });

    await wait(800);
    assert(
      node1ReceivedCursor,
      "Cross-node cursor broadcast: Node 2 (3002) propagated cursor to Node 1 (3001) via Redis adapter"
    );

  } catch (err: any) {
    assert(false, "Cluster test exception", err.message);
  } finally {
    socket1?.disconnect();
    socket2?.disconnect();
    if (process.platform === "win32") {
      try { if (server2Proc.pid) execSync(`taskkill /pid ${server2Proc.pid} /T /F`, { stdio: "ignore" }); } catch {}
    } else {
      try { server2Proc.kill("SIGKILL"); } catch {}
    }
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
